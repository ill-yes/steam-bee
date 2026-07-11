import { readFileSync } from "node:fs";
import {
  PACKAGE_PATHS,
  RELEASE_SOURCE_DEFAULTS,
  SOURCE_PACKAGE_VERSION,
} from "./release-metadata.mjs";

for (const path of PACKAGE_PATHS) {
  const packageJson = JSON.parse(readFileSync(path, "utf8"));
  if (packageJson.version !== SOURCE_PACKAGE_VERSION) {
    fail(
      `${path} uses ${packageJson.version}; private source packages must use ${SOURCE_PACKAGE_VERSION}.`,
    );
  }
}

for (const { path, expected } of RELEASE_SOURCE_DEFAULTS) {
  if (!readFileSync(path, "utf8").includes(expected)) {
    fail(`${path} is missing the release-neutral default: ${expected}`);
  }
}

process.stdout.write("Release source defaults are version-neutral.\n");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
