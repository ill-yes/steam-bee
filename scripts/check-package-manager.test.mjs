import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  parseExpectedPnpmVersion,
  pnpmVersionFromUserAgent,
  validatePackageManager,
} from "./check-package-manager.mjs";

const integrity = "a".repeat(128);
const packageManager = `pnpm@12.15.0+sha512.${integrity}`;

test("accepts the stable pnpm version with a complete SHA512 integrity pin", () => {
  assert.equal(parseExpectedPnpmVersion(packageManager), "12.15.0");
  assert.equal(
    parseExpectedPnpmVersion(`pnpm@12.15.0+sha512.${integrity.toUpperCase()}`),
    "12.15.0",
  );
});

test("rejects missing, malformed or wrong-manager integrity pins", () => {
  for (const pin of [
    undefined,
    null,
    12,
    "",
    "pnpm@12.15.0",
    "npm@12.15.0",
    `npm@12.15.0+sha512.${integrity}`,
    `pnpm@12.15.0+sha256.${integrity}`,
    `pnpm@12.15.0+sha512.${integrity.slice(1)}`,
    `pnpm@12.15.0+sha512.${integrity}a`,
    `pnpm@12.15.0+sha512.${"g".repeat(128)}`,
    `pnpm@12.15.0-beta+sha512.${integrity}`,
    `pnpm@012.15.0+sha512.${integrity}`,
    `pnpm@12.15+sha512.${integrity}`,
    ` ${packageManager}`,
    `${packageManager}\n`,
  ])
    assert.throws(() => parseExpectedPnpmVersion(pin), /must pin pnpm@X.Y.Z/);
});

test("explicit version accepts only the exact pin after trimming outer whitespace", () => {
  for (const actualVersion of ["12.15.0", " \n12.15.0\t "])
    assert.equal(
      validatePackageManager({ packageManager, actualVersion }),
      "12.15.0",
    );
});

test("rejects old, new, prerelease, decorated and multi-line version output", () => {
  for (const actualVersion of [
    "11.15.0",
    "12.14.9",
    "12.15.1",
    "13.0.0",
    "12.15.0-rc.1",
    "12.15.0+build.1",
    "pnpm 12.15.0",
    "v12.15.0",
    "notice\n12.15.0",
    "12.15.0\nnotice",
    "12.15.0 12.15.0",
    "12. 15.0",
    "",
    "   ",
    null,
    12,
  ])
    assert.throws(
      () => validatePackageManager({ packageManager, actualVersion }),
      /requires exactly pnpm 12.15.0/,
    );
});

test("preinstall accepts pnpm at the start of a normal user agent", () => {
  for (const userAgent of [
    "pnpm/12.15.0",
    "pnpm/12.15.0 npm/? node/v26.4.0 linux arm64",
    "pnpm/12.15.0\tnode/v26.4.0",
  ]) {
    assert.equal(pnpmVersionFromUserAgent(userAgent), "12.15.0");
    assert.equal(
      validatePackageManager({ packageManager, userAgent }),
      "12.15.0",
    );
  }
});

test("preinstall rejects absent, wrong-manager, malformed and prerelease user agents", () => {
  for (const userAgent of [
    undefined,
    null,
    "",
    "npm/12.15.0 node/v26.4.0",
    "yarn/12.15.0",
    "npm/1 pnpm/12.15.0",
    " pnpm/12.15.0",
    "pnpm/12.15.0-rc.1 npm/?",
    "pnpm/12.15.0+build.1",
    "pnpm/12.15.0extra",
    "pnpm/12.15",
    "pnpm/012.15.0",
  ])
    assert.throws(
      () => validatePackageManager({ packageManager, userAgent }),
      /must begin with pnpm\/X.Y.Z/,
    );
});

test("preinstall rejects both older and newer stable pnpm user agents", () => {
  for (const userAgent of [
    "pnpm/11.15.0 npm/?",
    "pnpm/12.14.9",
    "pnpm/12.15.1 npm/?",
    "pnpm/13.0.0",
  ])
    assert.throws(
      () => validatePackageManager({ packageManager, userAgent }),
      /requires exactly pnpm 12.15.0/,
    );
});

test("explicit CLI output takes precedence over user agent without falling back", () => {
  assert.equal(
    validatePackageManager({
      packageManager,
      actualVersion: "12.15.0",
      userAgent: "npm/1.0.0",
    }),
    "12.15.0",
  );
  assert.throws(
    () =>
      validatePackageManager({
        packageManager,
        actualVersion: "",
        userAgent: "pnpm/12.15.0",
      }),
    /requires exactly/,
  );
});

test("CLI uses its root manifest from an isolated cwd and never needs Corepack", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "steam-bee-pm-guard-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = fileURLToPath(
    new URL("./check-package-manager.mjs", import.meta.url),
  );
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const expected = manifest.packageManager.split("@")[1].split("+")[0];
  const run = (args, userAgent) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: directory,
      env: userAgent === undefined ? {} : { npm_config_user_agent: userAgent },
      encoding: "utf8",
      timeout: 5_000,
    });

  for (const [args, userAgent] of [
    [[` \n${expected}\t `], undefined],
    [[expected], "npm/1.0.0"],
    [[], `pnpm/${expected} npm/? node/v26.4.0`],
  ]) {
    const result = run(args, userAgent);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `pnpm ${expected}\n`);
    assert.equal(result.stderr, "");
  }

  for (const [args, userAgent] of [
    [[], undefined],
    [[], "npm/1.0.0"],
    [[], "pnpm/0.0.0"],
    [[], `pnpm/${expected}-rc.1`],
    [[""], `pnpm/${expected}`],
    [["0.0.0"], `pnpm/${expected}`],
    [[`${expected}\nextra-public-output`], undefined],
    [[expected, "extra-argument"], undefined],
  ]) {
    const result = run(args, userAgent);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^Package manager check failed:/);
    assert.equal(result.stderr.includes("extra-public-output"), false);
  }
});

test("importing the validator does not execute its CLI or inspect the caller's argv", () => {
  const moduleUrl = new URL("./check-package-manager.mjs", import.meta.url)
    .href;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `await import(${JSON.stringify(moduleUrl)})`,
      "extra-public-argument",
    ],
    { env: {}, encoding: "utf8", timeout: 5_000 },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});
