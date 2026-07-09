import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../src/util/crypto.js";
import { redact } from "../src/util/redact.js";
import { enforceGameLimit } from "../src/steam/validation.js";

describe("secret crypto", () => {
  it("round-trips encrypted values", () => {
    const encrypted = encryptSecret("refresh-token");
    expect(decryptSecret(encrypted)).toBe("refresh-token");
    expect(encrypted.ciphertext).not.toContain("refresh-token");
  });
});

describe("redaction", () => {
  it("redacts sensitive keys recursively", () => {
    expect(
      redact({
        password: "secret",
        nested: { refreshToken: "token" },
        ok: "value",
      }),
    ).toEqual({
      password: "[redacted]",
      nested: { refreshToken: "[redacted]" },
      ok: "value",
    });
  });
});

describe("game limits", () => {
  it("allows 32 app ids without custom title", () => {
    expect(() =>
      enforceGameLimit(Array.from({ length: 32 }, (_, index) => index + 1)),
    ).not.toThrow();
  });

  it("allows only 31 app ids with custom title", () => {
    expect(() =>
      enforceGameLimit(
        Array.from({ length: 32 }, (_, index) => index + 1),
        "Custom",
      ),
    ).toThrow(/Too many/);
  });
});
