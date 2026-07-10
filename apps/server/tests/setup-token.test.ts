import { writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertSetupToken,
  completeSetupToken,
  initializeSetupToken,
} from "../src/auth/setup-token.js";
import { config, paths } from "../src/config.js";

describe("persisted setup token", () => {
  const originalSetupToken = config.setupToken;

  beforeEach(() => {
    completeSetupToken();
    config.setupToken = undefined;
  });

  afterEach(() => {
    completeSetupToken();
    config.setupToken = originalSetupToken;
  });

  it("accepts a stored setup token with eight characters", () => {
    writeFileSync(paths.setupToken, "12345678\n", "utf8");

    initializeSetupToken(false);

    expect(() => assertSetupToken("12345678")).not.toThrow();
  });

  it("rejects a stored setup token with seven characters", () => {
    writeFileSync(paths.setupToken, "1234567\n", "utf8");

    expect(() => initializeSetupToken(false)).toThrow(/is invalid/);
  });
});
