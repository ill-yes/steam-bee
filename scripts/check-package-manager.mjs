import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const stableVersion = "(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)";
const pinnedManager = new RegExp(
  `^pnpm@(${stableVersion})\\+sha512\\.[a-fA-F0-9]{128}$`,
);
const pnpmUserAgent = new RegExp(`^pnpm/(${stableVersion})(?:\\s|$)`);

export function parseExpectedPnpmVersion(packageManager) {
  const match =
    typeof packageManager === "string" && packageManager.match(pinnedManager);
  if (!match)
    throw new Error(
      "package.json must pin pnpm@X.Y.Z+sha512.<128 hexadecimal characters>",
    );
  return match[1];
}

export function pnpmVersionFromUserAgent(userAgent) {
  const match = typeof userAgent === "string" && userAgent.match(pnpmUserAgent);
  if (!match)
    throw new Error(
      "npm_config_user_agent must begin with pnpm/X.Y.Z; use the pinned pnpm version",
    );
  return match[1];
}

export function validatePackageManager({
  packageManager,
  actualVersion,
  userAgent,
}) {
  const expected = parseExpectedPnpmVersion(packageManager);
  const actual =
    actualVersion === undefined
      ? pnpmVersionFromUserAgent(userAgent)
      : typeof actualVersion === "string"
        ? actualVersion.trim()
        : undefined;
  if (actual !== expected)
    throw new Error(`This repository requires exactly pnpm ${expected}`);
  return expected;
}

// Imports expose only the pure validators; invoking this file reads the public
// root manifest. Never launch a package manager as part of this check.
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length > 3)
      throw new Error(
        "Usage: node scripts/check-package-manager.mjs [ACTUAL_VERSION]",
      );
    const { packageManager } = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    const version = validatePackageManager({
      packageManager,
      actualVersion: process.argv[2],
      userAgent: process.env.npm_config_user_agent,
    });
    console.log(`pnpm ${version}`);
  } catch (error) {
    console.error(`Package manager check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
