import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";
import type { BackupManifest } from "@steam-bee/contracts";

const magic = "STEAMBEE-BACKUP-V1";
const allowedEntryPaths = new Set(["steam-bee.sqlite", "instance.secret"]);

type BackupEntry = { path: string; data: Buffer };
type EncryptedEnvelope = {
  format: typeof magic;
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
};

export function encryptBackup(
  entries: BackupEntry[],
  passphrase: string,
  migrationId: string | null,
  createdAt = Date.now(),
) {
  validatePassphrase(passphrase);
  const manifest: BackupManifest = {
    formatVersion: 1,
    createdAt,
    migrationId,
    entries: entries.map((entry) => ({
      path: entry.path,
      size: entry.data.length,
      sha256: sha256(entry.data),
    })),
  };
  validateManifest(manifest);
  const plaintext = Buffer.from(
    JSON.stringify({
      manifest,
      entries: entries.map((entry) => ({
        path: entry.path,
        data: entry.data.toString("base64"),
      })),
    }),
    "utf8",
  );
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, {
    N: 1 << 15,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(magic, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope: EncryptedEnvelope = {
    format: magic,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  return Buffer.from(JSON.stringify(envelope), "utf8");
}

export function decryptBackup(buffer: Buffer, passphrase: string) {
  validatePassphrase(passphrase);
  let envelope: EncryptedEnvelope;
  try {
    envelope = JSON.parse(buffer.toString("utf8")) as EncryptedEnvelope;
  } catch {
    throw new Error("Backup envelope is not valid JSON.");
  }
  if (envelope.format !== magic) throw new Error("Unsupported backup format.");
  const salt = decode(envelope.salt, "salt", 16);
  const iv = decode(envelope.iv, "iv", 12);
  const authTag = decode(envelope.authTag, "authTag", 16);
  const ciphertext = decode(envelope.ciphertext, "ciphertext");
  const key = scryptSync(passphrase, salt, 32, {
    N: 1 << 15,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(magic, "utf8"));
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    const payload = JSON.parse(plaintext.toString("utf8")) as {
      manifest: BackupManifest;
      entries: Array<{ path: string; data: string }>;
    };
    validateManifest(payload.manifest);
    const entries = payload.entries.map((entry) => ({
      path: entry.path,
      data: decode(entry.data, `entry ${entry.path}`),
    }));
    if (entries.length !== payload.manifest.entries.length) {
      throw new Error("Backup manifest entry count does not match payload.");
    }
    for (const manifestEntry of payload.manifest.entries) {
      const entry = entries.find(
        (candidate) => candidate.path === manifestEntry.path,
      );
      if (
        !entry ||
        entry.data.length !== manifestEntry.size ||
        sha256(entry.data) !== manifestEntry.sha256
      ) {
        throw new Error(`Backup checksum failed for ${manifestEntry.path}.`);
      }
    }
    return { manifest: payload.manifest, entries };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Backup"))
      throw error;
    throw new Error("Backup could not be decrypted or was tampered with.");
  }
}

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function validateManifest(manifest: BackupManifest) {
  if (
    manifest.formatVersion !== 1 ||
    !Number.isSafeInteger(manifest.createdAt) ||
    !Array.isArray(manifest.entries)
  ) {
    throw new Error("Backup manifest is invalid.");
  }
  const paths = new Set<string>();
  for (const entry of manifest.entries) {
    if (!allowedEntryPaths.has(entry.path) || paths.has(entry.path)) {
      throw new Error("Backup contains an unsupported or duplicate path.");
    }
    paths.add(entry.path);
  }
  if (![...allowedEntryPaths].every((path) => paths.has(path))) {
    throw new Error("Backup is missing required recovery data.");
  }
}

function validatePassphrase(passphrase: string) {
  if (passphrase.length < 12 || passphrase.length > 256) {
    throw new Error("Backup passphrase must contain 12 to 256 characters.");
  }
}

function decode(value: unknown, field: string, exactLength?: number) {
  if (
    typeof value !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    throw new Error(`Backup ${field} is not canonical base64.`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new Error(`Backup ${field} is not canonical base64.`);
  }
  if (exactLength !== undefined && decoded.length !== exactLength) {
    throw new Error(`Backup ${field} has an invalid length.`);
  }
  return decoded;
}
