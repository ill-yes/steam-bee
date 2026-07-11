import assert from "node:assert/strict";
import test from "node:test";
import {
  compareStableVersions,
  isStableVersion,
  PACKAGE_PATHS,
  RELEASE_TEXT_TARGETS,
  validateReleaseRequest,
  validateReleaseTransition,
} from "./release-metadata.mjs";

test("stable release versions are validated strictly", () => {
  assert.equal(isStableVersion("1.2.3"), true);
  assert.equal(isStableVersion("v1.2.3"), false);
  assert.equal(isStableVersion("1.2.3-beta.1"), false);
  assert.equal(isStableVersion("1.2"), false);
  assert.equal(isStableVersion("01.2.3"), false);
});

test("stable versions are compared numerically", () => {
  assert.equal(compareStableVersions("1.0.5", "1.0.4"), 1);
  assert.equal(compareStableVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareStableVersions("2.0.0", "10.0.0"), -1);
  assert.equal(compareStableVersions("1.0.5", "1.0.5"), 0);
  assert.equal(compareStableVersions("999999999999999999999.0.0", "2.0.0"), 1);
});

test("release metadata targets stay unique", () => {
  assert.equal(new Set(PACKAGE_PATHS).size, PACKAGE_PATHS.length);
  const textPaths = RELEASE_TEXT_TARGETS.map(({ path }) => path);
  assert.equal(new Set(textPaths).size, textPaths.length);
});

test("release transitions allow upgrades and idempotent preparation", () => {
  assert.equal(validateReleaseTransition("1.0.5", "1.0.6"), "upgrade");
  assert.equal(validateReleaseTransition("1.0.5", "1.0.5"), "same");
  assert.throws(
    () => validateReleaseTransition("1.0.5", "1.0.4"),
    /cannot move backward from 1\.0\.5 to 1\.0\.4/,
  );
});

test("manual release requests require main, a matching tag and a newer version", () => {
  assert.doesNotThrow(() =>
    validateReleaseRequest({
      version: "1.0.5",
      requestedVersion: "1.0.5",
      dispatchRef: "refs/heads/main",
      releaseTag: "v1.0.5",
      latestReleaseTag: "v1.0.4",
    }),
  );
  assert.throws(
    () =>
      validateReleaseRequest({
        version: "1.0.5",
        requestedVersion: "1.0.6",
        dispatchRef: "refs/heads/main",
        releaseTag: "v1.0.6",
      }),
    /Requested release 1\.0\.6 does not match package version 1\.0\.5/,
  );
  assert.throws(
    () =>
      validateReleaseRequest({
        version: "1.0.5",
        requestedVersion: "1.0.5",
        dispatchRef: "refs/tags/v1.0.5",
        releaseTag: "v1.0.5",
      }),
    /must be dispatched from main/,
  );
  assert.throws(
    () =>
      validateReleaseRequest({
        version: "1.0.5",
        requestedVersion: "1.0.5",
        dispatchRef: "refs/heads/main",
        releaseTag: "v1.0.4",
      }),
    /target v1\.0\.4 does not match package version v1\.0\.5/,
  );
  assert.throws(
    () =>
      validateReleaseRequest({
        version: "1.0.5",
        requestedVersion: "1.0.5",
        dispatchRef: "refs/heads/main",
        releaseTag: "v1.0.5",
        latestReleaseTag: "v1.0.5",
      }),
    /must be newer than the latest public release 1\.0\.5/,
  );
  assert.throws(
    () =>
      validateReleaseRequest({
        version: "1.0.5",
        requestedVersion: "1.0.5",
        dispatchRef: "refs/heads/main",
        releaseTag: "v1.0.5",
        latestReleaseTag: "v1.0.4-beta.1",
      }),
    /Latest GitHub Release has an unsupported tag/,
  );
});
