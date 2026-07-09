import {
  closeSync,
  fchmodSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { ERROR_CODES } from "@steam-bee/contracts";
import { config, paths } from "../config.js";
import { appError } from "../http/errors.js";
import { createLogger } from "../util/logger.js";

const setupLogger = createLogger("setup");
let activeToken: string | null = null;

export function initializeSetupToken(setupComplete: boolean) {
  if (setupComplete) {
    activeToken = null;
    removeSetupTokenFile();
    return;
  }

  if (config.setupToken) {
    activeToken = config.setupToken;
    return;
  }

  const generated = randomBytes(32).toString("base64url");
  if (createSetupTokenFile(generated)) {
    activeToken = generated;
    setupLogger.warn(`SteamBee setup token: ${generated}`);
    return;
  }

  const existing = readSetupTokenFile();
  if (!existing) {
    throw new Error("Setup token file disappeared before it could be read.");
  }
  activeToken = existing;
}

export function assertSetupToken(candidate: string) {
  if (!activeToken || !constantTimeEqual(activeToken, candidate)) {
    throw appError(
      "Setup token is invalid.",
      401,
      ERROR_CODES.setupTokenInvalid,
    );
  }
}

export function completeSetupToken() {
  activeToken = null;
  removeSetupTokenFile();
}

export function isSetupTokenRequired() {
  return activeToken !== null;
}

function removeSetupTokenFile() {
  try {
    unlinkSync(paths.setupToken);
  } catch (error) {
    if (!isFileError(error, "ENOENT")) throw error;
  }
}

function readSetupTokenFile() {
  let descriptor: number;
  try {
    descriptor = openSync(paths.setupToken, "r");
  } catch (error) {
    if (isFileError(error, "ENOENT")) return null;
    throw error;
  }

  try {
    setPrivateDescriptorMode(descriptor);
    const token = readFileSync(descriptor, "utf8").trim();
    if (token.length < 16) {
      throw new Error(
        `Setup token at ${paths.setupToken} is invalid. Remove it to generate a new token.`,
      );
    }
    return token;
  } finally {
    closeSync(descriptor);
  }
}

function createSetupTokenFile(token: string) {
  let descriptor: number;
  try {
    descriptor = openSync(paths.setupToken, "wx", 0o600);
  } catch (error) {
    if (isFileError(error, "EEXIST")) return false;
    throw error;
  }

  try {
    writeFileSync(descriptor, `${token}\n`, "utf8");
    setPrivateDescriptorMode(descriptor);
    return true;
  } finally {
    closeSync(descriptor);
  }
}

function setPrivateDescriptorMode(descriptor: number) {
  if (process.platform !== "win32") fchmodSync(descriptor, 0o600);
}

function isFileError(error: unknown, code: string) {
  return error instanceof Error && "code" in error && error.code === code;
}

function constantTimeEqual(expected: string, candidate: string) {
  const expectedBytes = Buffer.from(expected);
  const candidateBytes = Buffer.from(candidate);
  return (
    expectedBytes.length === candidateBytes.length &&
    timingSafeEqual(expectedBytes, candidateBytes)
  );
}
