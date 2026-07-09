import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";

const envSchema = z.object({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATA_DIR: z.string().default("./data"),
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((value) => value === "true"),
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
  SETUP_TOKEN: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(16).max(256).optional(),
  ),
  EVENT_RETENTION_DAYS: z.coerce.number().int().min(0).default(90),
  BUILD_VERSION: z.string().default("0.1.0-dev"),
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
  dataDir: resolve(env.DATA_DIR),
  publicDir:
    process.env.PUBLIC_DIR ??
    (process.env.NODE_ENV === "production"
      ? resolve(process.cwd(), "public")
      : resolve(process.cwd(), "apps/web/dist")),
};

mkdirSync(config.dataDir, { recursive: true });

export const paths = {
  database: join(config.dataDir, "steam-bee.sqlite"),
  secret: join(config.dataDir, "instance.secret"),
  setupToken: join(config.dataDir, "setup.token"),
  steamData: join(config.dataDir, "steam-data"),
};

mkdirSync(paths.steamData, { recursive: true });

let instanceSecret: Buffer | null = null;

export function getInstanceSecret(): Buffer {
  if (instanceSecret) return instanceSecret;

  try {
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
      mode: 0o600,
      flag: "wx",
    });
    instanceSecret = secret;
    return secret;
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

getInstanceSecret();
