import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { isIP } from "node:net";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { dataDirectory } from "./data-directory.js";

const privateDirectoryMode = 0o700;
const privateFileMode = 0o600;
export const MIN_SETUP_TOKEN_LENGTH = 8;
const packageVersion = readPackageVersion();
const trueProxyAliases = new Set(["true", "yes", "on"]);
const falseProxyAliases = new Set(["false", "no", "off", "0"]);

process.umask(0o077);

export type TrustProxyConfig = false | number | string[];

export function parseTrustProxy(value: string | undefined): TrustProxyConfig {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized === "" || falseProxyAliases.has(normalized)) return false;
  if (trueProxyAliases.has(normalized)) return 1;

  if (/^\d+$/.test(normalized)) {
    const hops = Number(normalized);
    if (Number.isSafeInteger(hops)) return hops === 0 ? false : hops;
  }

  const addresses = normalized.split(",").map((address) => address.trim());
  if (addresses.length > 0 && addresses.every(isValidProxyAddress)) {
    return addresses;
  }

  throw new Error(
    "TRUST_PROXY must be false, a true alias, a non-negative integer hop count, or a comma-separated list of IP addresses/CIDRs.",
  );
}

const trustProxySchema = z
  .string()
  .optional()
  .transform((value, context) => {
    try {
      return parseTrustProxy(value);
    } catch (error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          error instanceof Error ? error.message : "Invalid TRUST_PROXY.",
      });
      return z.NEVER;
    }
  });

const configuredSetupTokenSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(MIN_SETUP_TOKEN_LENGTH).max(256).optional(),
);

const envSchema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATA_DIR: z.string().default("./data"),
  TRUST_PROXY: trustProxySchema,
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default(process.env.NODE_ENV === "test" ? "silent" : "info"),
  LOG_REQUESTS: z
    .string()
    .optional()
    .transform((value) =>
      value === undefined ? process.env.NODE_ENV !== "test" : value === "true",
    ),
  LOG_QUIET_REQUESTS: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? true : value === "true")),
  SETUP_TOKEN: configuredSetupTokenSchema,
  EVENT_RETENTION_DAYS: z.coerce.number().int().min(0).default(90),
  BUILD_VERSION: z.string().default(`${packageVersion}-dev`),
  BUILD_REVISION: z.string().default("unknown"),
  BUILD_DATE: z.string().default("unknown"),
});

const env = envSchema.parse(process.env);

export const config = {
  host: env.HOST,
  port: env.PORT,
  trustProxy: env.TRUST_PROXY,
  cookieSecure: env.COOKIE_SECURE,
  logLevel: env.LOG_LEVEL,
  logRequests: env.LOG_REQUESTS,
  logQuietRequests: env.LOG_QUIET_REQUESTS,
  setupToken: env.SETUP_TOKEN,
  eventRetentionDays: env.EVENT_RETENTION_DAYS,
  build: {
    version: env.BUILD_VERSION,
    revision: env.BUILD_REVISION,
    buildDate: env.BUILD_DATE,
  },
  dataDir: dataDirectory,
  publicDir:
    process.env.PUBLIC_DIR ??
    (process.env.NODE_ENV === "production"
      ? resolve(process.cwd(), "public")
      : resolve(process.cwd(), "apps/web/dist")),
};

ensurePrivateDirectory(config.dataDir);

export const paths = {
  database: join(config.dataDir, "steam-bee.sqlite"),
  secret: join(config.dataDir, "instance.secret"),
  setupToken: join(config.dataDir, "setup.token"),
  steamData: join(config.dataDir, "steam-data"),
  instanceLease: join(config.dataDir, ".steam-bee-instance"),
};

ensurePrivateDirectory(paths.steamData);

let instanceSecret: Buffer | null = null;

export function getInstanceSecret(): Buffer {
  if (instanceSecret) return instanceSecret;

  try {
    setPrivateMode(paths.secret, privateFileMode);
    const encoded = readFileSync(paths.secret, "utf8").trim();
    const decoded = Buffer.from(encoded, "base64");
    const canonical = decoded.toString("base64").replace(/=+$/, "");
    if (decoded.length !== 32 || canonical !== encoded.replace(/=+$/, "")) {
      throw new Error(
        `Instance key at ${paths.secret} is invalid; expected exactly 32 base64-encoded bytes.`,
      );
    }
    instanceSecret = decoded;
    return decoded;
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    if (existsSync(paths.database)) {
      throw new Error(
        `Instance key is missing at ${paths.secret} while ${paths.database} already exists. Restore the original instance.secret before starting SteamBee.`,
      );
    }

    const secret = randomBytes(32);
    writeFileSync(paths.secret, secret.toString("base64"), {
      mode: privateFileMode,
      flag: "wx",
    });
    setPrivateMode(paths.secret, privateFileMode);
    instanceSecret = secret;
    return secret;
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isValidProxyAddress(value: string) {
  const [address, prefix, ...extra] = value.split("/");
  if (!address || extra.length > 0) return false;

  const version = isIP(address);
  if (version === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d+$/.test(prefix)) return false;

  const prefixLength = Number(prefix);
  return prefixLength <= (version === 4 ? 32 : 128);
}

function ensurePrivateDirectory(path: string) {
  mkdirSync(path, { recursive: true, mode: privateDirectoryMode });
  setPrivateMode(path, privateDirectoryMode);
}

function setPrivateMode(path: string, mode: number) {
  if (process.platform !== "win32") chmodSync(path, mode);
}

function readPackageVersion() {
  const metadata = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version?: unknown };
  if (typeof metadata.version !== "string" || metadata.version.length === 0) {
    throw new Error("Server package version is missing.");
  }
  return metadata.version;
}

getInstanceSecret();
