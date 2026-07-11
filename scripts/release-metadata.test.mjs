import assert from "node:assert/strict";
import test from "node:test";
import {
  compareStableVersions,
  incrementStableVersion,
  isStableVersion,
  PACKAGE_PATHS,
  parseStableReleaseTag,
  RELEASE_BUMPS,
  RELEASE_SOURCE_DEFAULTS,
  resolveReleasePlan,
} from "./release-metadata.mjs";

const dispatchSha = "1".repeat(40);
const reservedSha = "2".repeat(40);

test("stable release versions and tags are validated strictly", () => {
  assert.equal(isStableVersion("1.2.3"), true);
  assert.equal(isStableVersion("v1.2.3"), false);
  assert.equal(isStableVersion("1.2.3-beta.1"), false);
  assert.equal(isStableVersion("1.2"), false);
  assert.equal(isStableVersion("01.2.3"), false);
  assert.equal(parseStableReleaseTag("v1.2.3"), "1.2.3");
  assert.equal(parseStableReleaseTag("1.2.3"), null);
  assert.equal(parseStableReleaseTag("v1.2.3-rc.1"), null);
});

test("stable versions are compared and incremented numerically", () => {
  assert.equal(compareStableVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareStableVersions("2.0.0", "10.0.0"), -1);
  assert.equal(incrementStableVersion("1.0.5", "patch"), "1.0.6");
  assert.equal(incrementStableVersion("1.0.5", "minor"), "1.1.0");
  assert.equal(incrementStableVersion("1.0.5", "major"), "2.0.0");
  assert.equal(
    incrementStableVersion("999999999999999999999.0.0", "major"),
    "1000000000000000000000.0.0",
  );
  assert.throws(
    () => incrementStableVersion("1.0.5", "banana"),
    /Unsupported release bump/,
  );
});

test("release source metadata targets stay unique", () => {
  assert.deepEqual(RELEASE_BUMPS, ["patch", "minor", "major"]);
  assert.equal(new Set(PACKAGE_PATHS).size, PACKAGE_PATHS.length);
  const sourcePaths = RELEASE_SOURCE_DEFAULTS.map(({ path }) => path);
  assert.equal(new Set(sourcePaths).size, sourcePaths.length);
});

test("a fresh patch release increments the latest published release", () => {
  assert.deepEqual(
    resolveReleasePlan({
      bump: "patch",
      dispatchRef: "refs/heads/main",
      dispatchSha,
      publishedReleaseTags: ["v1.0.5", "v1.0.4"],
      tagCommits: { "v1.0.5": "0".repeat(40) },
    }),
    {
      status: "fresh",
      version: "1.0.6",
      tag: "v1.0.6",
      sourceCommit: dispatchSha,
      releaseExists: false,
    },
  );
});

test("minor and major plans derive from the latest semantic release", () => {
  const base = {
    dispatchRef: "refs/heads/main",
    dispatchSha,
    publishedReleaseTags: ["v1.9.9", "v1.10.0", "invalid"],
    tagCommits: {},
  };
  assert.equal(
    resolveReleasePlan({ ...base, bump: "minor" }).version,
    "1.11.0",
  );
  assert.equal(resolveReleasePlan({ ...base, bump: "major" }).version, "2.0.0");
});

test("an incomplete reserved tag resumes its original commit", () => {
  assert.deepEqual(
    resolveReleasePlan({
      bump: "patch",
      dispatchRef: "refs/heads/main",
      dispatchSha,
      publishedReleaseTags: ["v1.0.5"],
      tagCommits: { "v1.0.6": reservedSha },
    }),
    {
      status: "resume",
      version: "1.0.6",
      tag: "v1.0.6",
      sourceCommit: reservedSha,
      releaseExists: false,
    },
  );
});

test("an incomplete release resumes even when a different bump is selected", () => {
  const result = resolveReleasePlan({
    bump: "major",
    dispatchRef: "refs/heads/main",
    dispatchSha,
    publishedReleaseTags: ["v1.0.5"],
    tagCommits: { "v1.0.6": reservedSha },
  });
  assert.equal(result.status, "resume");
  assert.equal(result.version, "1.0.6");
  assert.equal(result.sourceCommit, reservedSha);
});

test("rerunning a completed release on its source commit is a no-op", () => {
  assert.deepEqual(
    resolveReleasePlan({
      bump: "patch",
      dispatchRef: "refs/heads/main",
      dispatchSha,
      publishedReleaseTags: ["v1.0.6", "v1.0.5"],
      tagCommits: { "v1.0.6": dispatchSha },
    }),
    {
      status: "complete",
      version: "1.0.6",
      tag: "v1.0.6",
      sourceCommit: dispatchSha,
      releaseExists: true,
    },
  );
});

test("invalid dispatches and missing release history fail safely", () => {
  const valid = {
    bump: "patch",
    dispatchRef: "refs/heads/main",
    dispatchSha,
    publishedReleaseTags: ["v1.0.5"],
    tagCommits: {},
  };
  assert.throws(
    () => resolveReleasePlan({ ...valid, dispatchRef: "refs/heads/feature" }),
    /must be dispatched from main/,
  );
  assert.throws(
    () => resolveReleasePlan({ ...valid, publishedReleaseTags: [] }),
    /No stable GitHub Release exists/,
  );
  assert.throws(
    () => resolveReleasePlan({ ...valid, dispatchSha: "short" }),
    /full lowercase Git SHA/,
  );
  assert.throws(
    () =>
      resolveReleasePlan({
        ...valid,
        tagCommits: { "v1.0.6": "not-a-sha" },
      }),
    /Commit for v1\.0\.6 must be a full lowercase Git SHA/,
  );
  assert.throws(
    () =>
      resolveReleasePlan({
        ...valid,
        tagCommits: {
          "v1.0.6": "2".repeat(40),
          "v1.1.0": "3".repeat(40),
        },
      }),
    /Multiple unpublished release tags require manual repair/,
  );
});
