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

    await expect(import("../src/config.js")).rejects.toThrow(
      /at least 8 character/,
    );
  });

  it("keeps an empty setup token optional", async () => {
    vi.stubEnv("SETUP_TOKEN", "");

    const { config } = await import("../src/config.js");

    expect(config.setupToken).toBeUndefined();
  });
});
