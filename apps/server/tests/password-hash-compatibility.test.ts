import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { migrate, sqlite } from "../src/db/client.js";

// Generated once on darwin/arm64 with hash(password) from the actual published
// @node-rs/argon2 2.1.0 and 2.2.0 packages, then verified by those same versions.
// These synthetic fixtures must not be regenerated with the current library.
const legacyHashes = JSON.parse(
  readFileSync(
    new URL("./fixtures/argon2-password-hashes.json", import.meta.url),
    "utf8",
  ),
) as Array<{ version: string; password: string; passwordHash: string }>;

describe.each(legacyHashes)(
  "Argon2 $version password compatibility",
  (legacy) => {
    beforeEach(() => {
      migrate();
      sqlite.exec("DELETE FROM admin_session; DELETE FROM admin_user;");
      const now = Date.now();
      sqlite
        .prepare(
          `INSERT INTO admin_user
          (id, singleton_key, password_hash, created_at, updated_at)
          VALUES (?, 1, ?, ?, ?)`,
        )
        .run("legacy-admin", legacy.passwordHash, now, now);
    });

    it("logs in without rewriting the old hash and allows a password change", async () => {
      const app = await buildApp({ initSteam: false });

      try {
        const wrongPassword = await app.inject({
          method: "POST",
          url: "/api/login",
          payload: { password: `${legacy.password} wrong` },
        });
        expect(wrongPassword.statusCode).toBe(401);
        expect(
          wrongPassword.cookies.some(({ name }) => name === "session"),
        ).toBe(false);

        const login = await app.inject({
          method: "POST",
          url: "/api/login",
          payload: { password: legacy.password },
        });
        expect(login.statusCode).toBe(200);
        const cookie = login.cookies.find(
          ({ name }) => name === "session",
        )?.value;
        expect(cookie).toBeTruthy();
        const { csrfToken } = login.json<{ csrfToken: string }>();
        expect(csrfToken).toBeTruthy();
        expect(
          sqlite.prepare("SELECT password_hash FROM admin_user").get(),
        ).toEqual({ password_hash: legacy.passwordHash });

        const me = await app.inject({
          method: "GET",
          url: "/api/me",
          cookies: { session: cookie! },
        });
        expect(me.json()).toMatchObject({
          authenticated: true,
          setupComplete: true,
        });

        const nextPassword = `${legacy.password} updated`;
        const changed = await app.inject({
          method: "PUT",
          url: "/api/admin/password",
          cookies: { session: cookie! },
          headers: { "x-csrf-token": csrfToken },
          payload: {
            currentPassword: legacy.password,
            newPassword: nextPassword,
          },
        });
        expect(changed.statusCode).toBe(200);

        const oldLogin = await app.inject({
          method: "POST",
          url: "/api/login",
          payload: { password: legacy.password },
        });
        expect(oldLogin.statusCode).toBe(401);

        const newLogin = await app.inject({
          method: "POST",
          url: "/api/login",
          payload: { password: nextPassword },
        });
        expect(newLogin.statusCode).toBe(200);
        expect(
          newLogin.cookies.some(
            ({ name, value }) => name === "session" && value,
          ),
        ).toBe(true);
      } finally {
        await app.close();
      }
    });
  },
);
