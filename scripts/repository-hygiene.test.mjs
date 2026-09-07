import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";

const runtimeArtifacts = [
  "custom/runtime/instance.secret",
  "custom/runtime/setup.token",
  "custom/runtime/portable-backup.sbb",
  "custom/runtime/.steam-bee-instance",
  "custom/runtime/.steam-bee-instance-journal",
  "custom/runtime/.steam-bee-instance/owner.json",
  "custom/runtime/.steam-bee-instance.stale-00000000-0000-0000-0000-000000000000/owner.json",
  "custom/runtime/.steam-bee-restore-staging/steam-bee.sqlite",
  "custom/runtime/.steam-bee-restore-rollback/instance.secret",
  "custom/runtime/.steam-bee-data-v1/marker",
];

test("runtime credentials and recovery artifacts are ignored at custom depths", () => {
  const result = spawnSync("git", ["check-ignore", "--no-index", "--stdin"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    input: `${runtimeArtifacts.join("\n")}\n`,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split("\n"), runtimeArtifacts);
});

test("fixture-like names remain visible while forbidden runtime artifacts stay untracked", () => {
  const fixture = spawnSync(
    "git",
    ["check-ignore", "--no-index", "synthetic-v1.sbb.fixture"],
    { cwd: new URL("..", import.meta.url), encoding: "utf8" },
  );
  assert.equal(fixture.status, 1, fixture.stderr);

  const tracked = execFileSync("git", ["ls-files"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
  const forbidden = tracked.filter((path) =>
    /(^|\/)(instance\.secret|setup\.token|\.steam-bee-instance(?:-journal|\.stale-[^/]*)?|\.steam-bee-restore-(?:staging|rollback)|\.steam-bee-data-v1)(\/|$)|\.sbb$/u.test(
      path,
    ),
  );
  assert.deepEqual(forbidden, []);
});
