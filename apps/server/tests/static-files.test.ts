import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  FastifyInstance,
  InjectOptions,
  LightMyRequestResponse,
} from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";

const indexHtml = "<!doctype html><title>Synthetic SteamBee shell</title>";
const assetScript = 'console.log("synthetic-static-asset");';
const outsideContent = "synthetic-private-file-must-never-be-served";
const shadowApiContent = "synthetic-static-file-must-not-shadow-protected-api";
const require = createRequire(import.meta.url);
const fastifyRequire = createRequire(require.resolve("fastify"));
const inject: (
  dispatch: FastifyInstance["routing"],
  options: InjectOptions,
) => Promise<LightMyRequestResponse> = fastifyRequire("light-my-request");

describe("static files and API routing", () => {
  let app: FastifyInstance | undefined;
  let fixtureDir: string | undefined;
  const originalPublicDir = config.publicDir;

  beforeAll(async () => {
    fixtureDir = mkdtempSync(join(tmpdir(), "steam-bee-static-test-"));
    config.publicDir = join(fixtureDir, "public");
    mkdirSync(join(config.publicDir, "assets"), { recursive: true });
    mkdirSync(join(config.publicDir, "api"));
    writeFileSync(join(config.publicDir, "index.html"), indexHtml);
    writeFileSync(join(config.publicDir, "assets", "app.js"), assetScript);
    writeFileSync(join(fixtureDir, "private.txt"), outsideContent);
    writeFileSync(join(config.publicDir, "api", "accounts"), shadowApiContent);
    app = await buildApp({ initSteam: false });
    await app.ready();
  });

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      config.publicDir = originalPublicDir;
      if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it.each(["/", "/index.html"])(
    "serves the application shell at %s",
    async (url) => {
      const response = await app!.inject({ method: "GET", url });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/html");
      expect(response.body).toBe(indexHtml);
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["content-security-policy"]).toContain(
        "script-src 'self'",
      );
      const head = await app!.inject({ method: "HEAD", url });
      expect(head.statusCode).toBe(200);
      expect(head.body).toBe("");
      expect(head.headers["content-length"]).toBe(
        String(Buffer.byteLength(indexHtml)),
      );
    },
  );

  it("serves an asset with its content type and supports HEAD", async () => {
    const response = await app!.inject({
      method: "GET",
      url: "/assets/app.js",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/javascript/);
    expect(response.body).toBe(assetScript);
    const head = await app!.inject({ method: "HEAD", url: "/assets/app.js" });
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe("");
    expect(head.headers["content-length"]).toBe(
      String(Buffer.byteLength(assetScript)),
    );
  });

  // The current SPA contract also returns the shell for missing non-API assets.
  it.each(["/accounts/example", "/assets/missing.js"])(
    "preserves SPA fallback at %s",
    async (url) => {
      const response = await app!.inject({ method: "GET", url });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/html");
      expect(response.body).toBe(indexHtml);
    },
  );

  it.each(["/api/accounts", "/api/diagnostics", "/api/system/status"])(
    "keeps %s protected without a session",
    async (url) => {
      const response = await app!.inject({ method: "GET", url });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        error: "Not signed in.",
        code: "AUTH_REQUIRED",
      });
      expect(response.headers["cache-control"]).toBe("no-store");
    },
  );

  it("does not substitute the shell for a missing API route", async () => {
    const response = await app!.inject({
      method: "GET",
      url: "/api/not-a-route",
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Not found.", code: "NOT_FOUND" });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it.each([
    "/../private.txt",
    "/%2e%2e/private.txt",
    "/assets/%2e%2e/%2e%2e/private.txt",
    "/%2e%2e%2fprivate.txt",
    "/%252e%252e%252fprivate.txt",
    "/..%5cprivate.txt",
    "/./../private.txt",
    "//../private.txt",
  ])("does not disclose a file outside publicDir through %s", async (url) => {
    const response = await injectRawPath(url);
    expect(response.body).not.toContain(outsideContent);
    if (response.statusCode === 200) {
      expect(response.body).toBe(indexHtml);
      expect(response.headers["content-type"]).toContain("text/html");
    } else {
      expect([400, 403, 404]).toContain(response.statusCode);
    }
  });

  it.each([
    "/api/%61ccounts",
    "/%61pi/accounts",
    "/api%2faccounts",
    "/assets/../api/accounts",
    "/assets/%2e%2e/api/accounts",
    "//api/accounts",
    "/./api/accounts",
    "/%2e/api/accounts",
  ])("does not expose authenticated API data through %s", async (url) => {
    const response = await injectRawPath(url);
    expect(response.body).not.toContain(shadowApiContent);
    if (response.statusCode === 200) {
      expect(response.body).toBe(indexHtml);
      expect(response.headers["content-type"]).toContain("text/html");
    } else {
      expect([400, 401, 403, 404]).toContain(response.statusCode);
      if (response.statusCode === 401) {
        expect(response.json()).toMatchObject({ code: "AUTH_REQUIRED" });
      }
    }
  });

  function injectRawPath(pathname: string) {
    // Inject normally normalizes dot segments before routing; preserve the raw
    // request target so these cases exercise the server's actual path defenses.
    return inject(
      (request, response) => {
        request.url = pathname;
        app!.routing(request, response);
      },
      { method: "GET", url: "/" },
    );
  }
});
