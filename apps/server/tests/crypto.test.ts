import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../src/util/crypto.js";
import { redact } from "../src/util/redact.js";
import { enforceGameLimit } from "../src/steam/validation.js";

describe("secret crypto", () => {
  it("round-trips encrypted values", () => {
    const encrypted = encryptSecret("refresh-token");
    expect(decryptSecret(encrypted)).toBe("refresh-token");
    expect(encrypted.ciphertext).not.toContain("refresh-token");
    expect(Buffer.from(encrypted.authTag, "base64")).toHaveLength(16);
  });

  it("rejects authentication tags shorter than 16 bytes", () => {
    const encrypted = encryptSecret("refresh-token");
    const shortAuthTag = Buffer.from(encrypted.authTag, "base64")
      .subarray(0, 15)
      .toString("base64");

    expect(() =>
      decryptSecret({ ...encrypted, authTag: shortAuthTag }),
    ).toThrow(/authTag must decode to exactly 16 bytes/);
  });

  it("rejects IVs that are not 12 bytes", () => {
    const encrypted = encryptSecret("refresh-token");
    const shortIv = Buffer.from(encrypted.iv, "base64")
      .subarray(0, 11)
      .toString("base64");

    expect(() => decryptSecret({ ...encrypted, iv: shortIv })).toThrow(
      /iv must decode to exactly 12 bytes/,
    );
  });

  it("rejects a different 12-byte IV", () => {
    const encrypted = encryptSecret("refresh-token");
    const wrongIv = Buffer.from(encrypted.iv, "base64");
    wrongIv[0] ^= 0xff;

    expect(() =>
      decryptSecret({ ...encrypted, iv: wrongIv.toString("base64") }),
    ).toThrow();
  });

  it.each(["ciphertext", "iv", "authTag"] as const)(
    "rejects malformed base64 in %s",
    (field) => {
      const encrypted = encryptSecret("refresh-token");

      expect(() =>
        decryptSecret({ ...encrypted, [field]: "not-base64!" }),
      ).toThrow(new RegExp(`${field} must be canonical base64`));
    },
  );

  it("rejects unsupported key versions", () => {
    const encrypted = encryptSecret("refresh-token");

    expect(() => decryptSecret({ ...encrypted, keyVersion: 2 })).toThrow(
      /Unsupported encrypted payload key version: 2/,
    );
  });
});

describe("redaction", () => {
  it("redacts sensitive keys recursively", () => {
    expect(
      redact({
        password: "secret",
        nested: { refreshToken: "token", steamGuardCode: "12345" },
        errorCode: "ACCOUNT_NOT_FOUND",
        ok: "value",
      }),
    ).toEqual({
      password: "[redacted]",
      nested: {
        refreshToken: "[redacted]",
        steamGuardCode: "[redacted]",
      },
      errorCode: "ACCOUNT_NOT_FOUND",
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
