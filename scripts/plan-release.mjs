import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolveReleasePlan } from "./release-metadata.mjs";

const repository = requiredEnv("GITHUB_REPOSITORY");
const dispatchRef = requiredEnv("GITHUB_REF");
const dispatchSha = requiredEnv("GITHUB_SHA");
const bump = requiredEnv("RELEASE_BUMP");

const publishedReleaseTags = JSON.parse(
  execFileSync(
    "gh",
    [
      "release",
      "list",
      "--repo",
      repository,
      "--exclude-drafts",
      "--exclude-pre-releases",
      "--limit",
      "100",
      "--json",
      "tagName",
    ],
    { encoding: "utf8" },
  ),
).map(({ tagName }) => tagName);

const tagCommits = Object.fromEntries(
  execFileSync("git", ["tag", "--list", "v*"], { encoding: "utf8" })
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((tag) => [
      tag,
      execFileSync("git", ["rev-list", "-n", "1", tag], {
        encoding: "utf8",
      }).trim(),
    ]),
);

const releasePlan = resolveReleasePlan({
  bump,
  dispatchRef,
  dispatchSha,
  publishedReleaseTags,
  tagCommits,
});

execFileSync(
  "git",
  ["merge-base", "--is-ancestor", releasePlan.sourceCommit, "origin/main"],
  { stdio: "inherit" },
);

const buildDate = execFileSync(
  "git",
  ["show", "-s", "--format=%cI", releasePlan.sourceCommit],
  { encoding: "utf8" },
).trim();

const outputs = {
  ...releasePlan,
  releaseExists: String(releasePlan.releaseExists),
  buildDate,
};

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `${Object.entries(outputs)
      .map(([key, value]) => `${toSnakeCase(key)}=${value}`)
      .join("\n")}\n`,
  );
}

process.stdout.write(`${JSON.stringify(outputs, null, 2)}\n`);

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function toSnakeCase(value) {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
