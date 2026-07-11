import { readFileSync, writeFileSync } from "node:fs";
import {
  isStableVersion,
  PACKAGE_PATHS,
  RELEASE_TEXT_TARGETS,
  validateReleaseTransition,
} from "./release-metadata.mjs";

const nextVersion = process.argv[2];

if (!isStableVersion(nextVersion)) {
  fail("Usage: pnpm release:prepare <major.minor.patch>");
}

const packages = new Map(
  PACKAGE_PATHS.map((path) => [path, JSON.parse(readFileSync(path, "utf8"))]),
);
const currentVersion = packages.get("package.json")?.version;

if (typeof currentVersion !== "string") {
  fail("package.json does not contain a version.");
}

for (const [path, packageJson] of packages) {
  if (packageJson.version !== currentVersion) {
    fail(
      `${path} has version ${packageJson.version}; expected ${currentVersion} before preparing a release.`,
    );
  }
}

let transition;
try {
  transition = validateReleaseTransition(currentVersion, nextVersion);
} catch (error) {
  fail(error instanceof Error ? error.message : "Invalid release transition.");
}

const updates = new Map();

for (const [path, packageJson] of packages) {
  updates.set(
    path,
    `${JSON.stringify({ ...packageJson, version: nextVersion }, null, 2)}\n`,
  );
}

for (const { path, replacement } of RELEASE_TEXT_TARGETS) {
  replaceRequired(path, replacement(currentVersion), replacement(nextVersion));
}

for (const [path, content] of updates) {
  writeFileSync(path, content);
}

process.stdout.write(
  transition === "same"
    ? `Release metadata is already prepared for ${nextVersion}.\n`
    : `Prepared release metadata ${currentVersion} -> ${nextVersion}.\n`,
);
process.stdout.write("Review the diff and run pnpm release:check.\n");

function replaceRequired(path, from, to) {
  const content = readFileSync(path, "utf8");
  if (!content.includes(from)) {
    fail(`${path} does not contain expected release metadata: ${from}`);
  }
  updates.set(path, content.replaceAll(from, to));
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
