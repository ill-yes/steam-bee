export const PACKAGE_PATHS = [
  "package.json",
  "apps/server/package.json",
  "apps/web/package.json",
  "packages/contracts/package.json",
];

export const RELEASE_TEXT_TARGETS = [
  target(
    "compose.image.yml",
    (version) => `ghcr.io/ill-yes/steam-bee:${version}`,
  ),
  target(".env.example", (version) => `ghcr.io/ill-yes/steam-bee:${version}`),
  target("Dockerfile", (version) => `ARG VERSION=${version}-dev`),
  target(
    "docs/DEPLOYMENT.md",
    (version) => `ghcr.io/ill-yes/steam-bee:${version}`,
    (version) => version,
  ),
  target(
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    (version) => `SteamBee ${version}; ghcr.io/ill-yes/steam-bee:${version}`,
    (version) => version,
  ),
];

export function isStableVersion(value) {
  return (
    typeof value === "string" &&
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
  );
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

export function validateReleaseTransition(currentVersion, nextVersion) {
  if (!isStableVersion(currentVersion)) {
    throw new Error(
      `Current version is not a stable semantic version: ${currentVersion}`,
    );
  }
  if (!isStableVersion(nextVersion)) {
    throw new Error(
      `Next version is not a stable semantic version: ${nextVersion}`,
    );
  }

  const comparison = compareStableVersions(nextVersion, currentVersion);
  if (comparison < 0) {
    throw new Error(
      `Release metadata cannot move backward from ${currentVersion} to ${nextVersion}.`,
    );
  }
  return comparison === 0 ? "same" : "upgrade";
}

export function validateReleaseRequest({
  version,
  requestedVersion,
  dispatchRef,
  releaseTag,
  latestReleaseTag,
}) {
  if (!isStableVersion(version)) {
    throw new Error(
      `Root package version is not a stable semantic version: ${version}`,
    );
  }

  if (requestedVersion === undefined) return;
  if (requestedVersion !== version) {
    throw new Error(
      `Requested release ${requestedVersion} does not match package version ${version}.`,
    );
  }
  if (dispatchRef !== "refs/heads/main") {
    throw new Error(
      `Release ${version} must be dispatched from main; received ${dispatchRef || "no ref"}.`,
    );
  }
  if (releaseTag !== `v${version}`) {
    throw new Error(
      `Release target ${releaseTag || "no tag"} does not match package version v${version}.`,
    );
  }

  if (!latestReleaseTag) return;
  const latestVersion = latestReleaseTag.startsWith("v")
    ? latestReleaseTag.slice(1)
    : latestReleaseTag;
  if (!isStableVersion(latestVersion)) {
    throw new Error(
      `Latest GitHub Release has an unsupported tag: ${latestReleaseTag}.`,
    );
  }
  if (compareStableVersions(requestedVersion, latestVersion) <= 0) {
    throw new Error(
      `Release ${requestedVersion} must be newer than the latest public release ${latestVersion}.`,
    );
  }
}

function target(path, expected, replacement = expected) {
  return { path, expected, replacement };
}
