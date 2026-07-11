export const RELEASE_BUMPS = ["patch", "minor", "major"];
export const SOURCE_PACKAGE_VERSION = "0.0.0";

export const PACKAGE_PATHS = [
  "package.json",
  "apps/server/package.json",
  "apps/web/package.json",
  "packages/contracts/package.json",
];

export const RELEASE_SOURCE_DEFAULTS = [
  {
    path: "compose.image.yml",
    expected: "ghcr.io/ill-yes/steam-bee:latest",
  },
  {
    path: ".env.example",
    expected: "ghcr.io/ill-yes/steam-bee:latest",
  },
  { path: "Dockerfile", expected: "ARG VERSION=dev" },
  {
    path: ".github/ISSUE_TEMPLATE/bug_report.yml",
    expected: "SteamBee 1.2.3; ghcr.io/ill-yes/steam-bee:1.2.3",
  },
];

export function isStableVersion(value) {
  return (
    typeof value === "string" &&
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
  );
}

export function parseStableReleaseTag(value) {
  if (typeof value !== "string" || !value.startsWith("v")) return null;
  const version = value.slice(1);
  return isStableVersion(version) ? version : null;
}

export function compareStableVersions(left, right) {
  if (!isStableVersion(left) || !isStableVersion(right)) {
    throw new Error(`Cannot compare unstable versions: ${left}, ${right}`);
  }

  const leftParts = left.split(".").map(BigInt);
  const rightParts = right.split(".").map(BigInt);
  for (let index = 0; index < leftParts.length; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart < rightPart) return -1;
    if (leftPart > rightPart) return 1;
  }
  return 0;
}

export function incrementStableVersion(version, bump) {
  if (!isStableVersion(version)) {
    throw new Error(`Cannot increment unstable version: ${version}`);
  }
  if (!RELEASE_BUMPS.includes(bump)) {
    throw new Error(`Unsupported release bump: ${bump}`);
  }

  const [major, minor, patch] = version.split(".").map(BigInt);
  if (bump === "major") return `${major + 1n}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1n}.0`;
  return `${major}.${minor}.${patch + 1n}`;
}

export function resolveReleasePlan({
  bump,
  dispatchRef,
  dispatchSha,
  publishedReleaseTags,
  tagCommits,
}) {
  if (dispatchRef !== "refs/heads/main") {
    throw new Error(
      `Release workflow must be dispatched from main; received ${dispatchRef || "no ref"}.`,
    );
  }
  assertCommitSha(dispatchSha, "Dispatch SHA");
  if (!RELEASE_BUMPS.includes(bump)) {
    throw new Error(`Unsupported release bump: ${bump}`);
  }

  const stableReleases = publishedReleaseTags
    .map((tag) => ({ tag, version: parseStableReleaseTag(tag) }))
    .filter(({ version }) => version !== null)
    .sort((left, right) => compareStableVersions(right.version, left.version));

  if (stableReleases.length === 0) {
    throw new Error("No stable GitHub Release exists to increment.");
  }

  const completedForCommit = stableReleases.find(
    ({ tag }) => tagCommits[tag] === dispatchSha,
  );
  if (completedForCommit) {
    return plan(
      "complete",
      completedForCommit.version,
      completedForCommit.tag,
      dispatchSha,
      true,
    );
  }

  const latestVersion = stableReleases[0].version;
  const publishedTagSet = new Set(stableReleases.map(({ tag }) => tag));
  const pendingTags = Object.entries(tagCommits)
    .map(([tag, commit]) => ({
      tag,
      commit,
      version: parseStableReleaseTag(tag),
    }))
    .filter(
      ({ tag, version }) =>
        version !== null &&
        !publishedTagSet.has(tag) &&
        compareStableVersions(version, latestVersion) > 0,
    )
    .sort((left, right) => compareStableVersions(left.version, right.version));

  if (pendingTags.length > 1) {
    throw new Error(
      `Multiple unpublished release tags require manual repair: ${pendingTags.map(({ tag }) => tag).join(", ")}.`,
    );
  }
  if (pendingTags.length === 1) {
    const pending = pendingTags[0];
    assertCommitSha(pending.commit, `Commit for ${pending.tag}`);
    return plan("resume", pending.version, pending.tag, pending.commit, false);
  }

  const version = incrementStableVersion(latestVersion, bump);
  const tag = `v${version}`;
  return plan("fresh", version, tag, dispatchSha, false);
}

function plan(status, version, tag, sourceCommit, releaseExists) {
  return { status, version, tag, sourceCommit, releaseExists };
}

function assertCommitSha(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(`${label} must be a full lowercase Git SHA.`);
  }
}
