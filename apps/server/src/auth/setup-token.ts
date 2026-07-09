import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
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

  if (existsSync(paths.setupToken)) {
    const existing = readFileSync(paths.setupToken, "utf8").trim();
    if (existing.length < 16) {
      throw new Error(
        `Setup token at ${paths.setupToken} is invalid. Remove it to generate a new token.`,
      );
    }
    activeToken = existing;
    setupLogger.warn(`SteamBee setup token: ${existing}`);
    return;
  }

  const generated = randomBytes(32).toString("base64url");
  writeFileSync(paths.setupToken, `${generated}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  activeToken = generated;
  setupLogger.warn(`SteamBee setup token: ${generated}`);
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
  if (!existsSync(paths.setupToken)) return;
  unlinkSync(paths.setupToken);
}

function constantTimeEqual(expected: string, candidate: string) {
  const expectedBytes = Buffer.from(expected);
  const candidateBytes = Buffer.from(candidate);
  return (
    expectedBytes.length === candidateBytes.length &&
    timingSafeEqual(expectedBytes, candidateBytes)
  );
}
