import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("runtime configuration", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("accepts a configured setup token with eight characters", async () => {
    vi.stubEnv("SETUP_TOKEN", "12345678");

    const { config } = await import("../src/config.js");

    expect(config.setupToken).toBe("12345678");
  });

  it("rejects a configured setup token with seven characters", async () => {
    vi.stubEnv("SETUP_TOKEN", "1234567");

    await expect(import("../src/config.js")).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "too_small",
          minimum: 8,
          path: ["SETUP_TOKEN"],
        }),
      ]),
    });
  });

  it("keeps an empty setup token optional", async () => {
    vi.stubEnv("SETUP_TOKEN", "");

    const { config } = await import("../src/config.js");

    expect(config.setupToken).toBeUndefined();
  });

  it("uses safe local and package-derived development defaults", async () => {
    const originalHost = process.env.HOST;
    const originalBuildVersion = process.env.BUILD_VERSION;
    delete process.env.HOST;
    delete process.env.BUILD_VERSION;

    try {
      const { config } = await import("../src/config.js");

      expect(config.host).toBe("127.0.0.1");
      expect(config.build.version).toMatch(/^\d+\.\d+\.\d+-dev$/);
    } finally {
      if (originalHost === undefined) delete process.env.HOST;
      else process.env.HOST = originalHost;
      if (originalBuildVersion === undefined) delete process.env.BUILD_VERSION;
      else process.env.BUILD_VERSION = originalBuildVersion;
    }
  });
});
