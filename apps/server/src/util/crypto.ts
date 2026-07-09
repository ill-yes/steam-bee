import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { getInstanceSecret } from "../config.js";

const ALGORITHM = "aes-256-gcm";
const AUTH_TAG_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_VERSION = 1;
const BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function key() {
  return createHash("sha256").update(getInstanceSecret()).digest();
}

export type EncryptedValue = {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
};

export function encryptSecret(plainText: string): EncryptedValue {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key(), iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plainText, "utf8")),
    cipher.final(),
  ]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: KEY_VERSION,
  };
}

export function decryptSecret(value: EncryptedValue): string {
  const { ciphertext, iv, authTag } = validateEncryptedValue(value);
  const decipher = createDecipheriv(ALGORITHM, key(), iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

function validateEncryptedValue(value: EncryptedValue) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid encrypted payload: expected an object.");
  }

  const payload = value as unknown as Record<string, unknown>;
  if (!Number.isInteger(payload.keyVersion)) {
    throw new Error(
      "Invalid encrypted payload: keyVersion must be an integer.",
    );
  }
  if (payload.keyVersion !== KEY_VERSION) {
    throw new Error(
      `Unsupported encrypted payload key version: ${String(payload.keyVersion)}.`,
    );
  }

  const ciphertext = decodeBase64Field(payload, "ciphertext");
  const iv = decodeBase64Field(payload, "iv");
  const authTag = decodeBase64Field(payload, "authTag");

  if (iv.length !== IV_LENGTH) {
    throw new Error(
      `Invalid encrypted payload: iv must decode to exactly ${IV_LENGTH} bytes.`,
    );
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(
      `Invalid encrypted payload: authTag must decode to exactly ${AUTH_TAG_LENGTH} bytes.`,
    );
  }

  return { ciphertext, iv, authTag };
}

function decodeBase64Field(
  payload: Record<string, unknown>,
  field: "ciphertext" | "iv" | "authTag",
): Buffer {
  const encoded = payload[field];
  if (typeof encoded !== "string" || !BASE64_PATTERN.test(encoded)) {
    throw new Error(
      `Invalid encrypted payload: ${field} must be canonical base64.`,
    );
  }

  const decoded = Buffer.from(encoded, "base64");
  if (decoded.toString("base64") !== encoded) {
    throw new Error(
      `Invalid encrypted payload: ${field} must be canonical base64.`,
    );
  }
  return decoded;
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function decodeJwtExpiry(token: string): number | null {
  const [, payload] = token.split(".");
  if (!payload) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as {
      exp?: number;
    };
    return parsed.exp ? parsed.exp * 1000 : null;
  } catch {
    return null;
  }
}
