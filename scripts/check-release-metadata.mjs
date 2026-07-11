import { readFileSync } from "node:fs";
import {
  PACKAGE_PATHS,
  RELEASE_TEXT_TARGETS,
  validateReleaseRequest,
} from "./release-metadata.mjs";

const rootPackage = readJson("package.json");
const version = rootPackage.version;

try {
  validateReleaseRequest({
    version,
    requestedVersion: process.env.RELEASE_VERSION,
    dispatchRef: process.env.RELEASE_DISPATCH_REF,
    releaseTag: process.env.RELEASE_TAG,
    latestReleaseTag: process.env.LATEST_RELEASE_TAG,
  });
} catch (error) {
  fail(error instanceof Error ? error.message : "Invalid release request.");
}

for (const path of PACKAGE_PATHS.slice(1)) {
  const packageVersion = readJson(path).version;
  if (packageVersion !== version) {
    fail(`${path} has version ${packageVersion}; expected ${version}.`);
  }
}

for (const { path, expected: expectedForVersion } of RELEASE_TEXT_TARGETS) {
  const expected = expectedForVersion(version);
  if (!readFileSync(path, "utf8").includes(expected)) {
    fail(`${path} is missing release metadata: ${expected}`);
  }
}

process.stdout.write(`Release metadata matches ${version}.\n`);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
