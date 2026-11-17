import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { pathToFileURL } from "node:url";

// picomatch remains the genuine upstream 4.0.7 package. This local mitigation
// deliberately rejects repeated extglobs, not just the currently reported
// examples. It does not make the version-based npm audit finding disappear.
const webRequire = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const serverRequire = createRequire(
  new URL("../apps/server/package.json", import.meta.url),
);
const viteRequire = createRequire(webRequire.resolve("vite/package.json"));
const tinyglobbyRequire = createRequire(viteRequire.resolve("tinyglobby"));
const consumers = [
  ["web Vite", viteRequire],
  ["web Vitest", createRequire(webRequire.resolve("vitest/package.json"))],
  [
    "server Vitest",
    createRequire(serverRequire.resolve("vitest/package.json")),
  ],
  ["tinyglobby", tinyglobbyRequire],
  ["fdir peer", createRequire(tinyglobbyRequire.resolve("fdir"))],
];
const resolved = consumers.map(([consumer, request]) => ({
  consumer,
  entry: request.resolve("picomatch"),
  manifest: request.resolve("picomatch/package.json"),
}));
const entries = [...new Set(resolved.map(({ entry }) => entry))];
const rejection =
  /Repeated extglobs are disabled by the SteamBee picomatch security patch/;

test("every installed tooling consumer resolves the pinned picomatch patch", () => {
  assert.equal(resolved.length, 5);
  for (const { consumer, manifest, entry } of resolved) {
    const metadata = JSON.parse(readFileSync(manifest, "utf8"));
    assert.equal(metadata.name, "picomatch", consumer);
    assert.equal(metadata.version, "4.0.7", consumer);
    const picomatch = createRequire(import.meta.url)(entry);
    assert.throws(() => picomatch("+(*)b"), {
      name: "SyntaxError",
      message: rejection,
    });
  }
});

const patterns = [
  "+(*)b",
  "+(*a)b",
  "*(*)b",
  "*(*a)b",
  "+(a|aa)b",
  "*(a|aa)b",
  "+(a|b)b",
  "*(a|b)b",
  "@(+(*a))b",
  "?(*(+(*a)))b",
  "!(*(+(*a)))b",
  "x/+(*a)b",
];
const child = String.raw`
  const assert = require("node:assert/strict");
  const picomatch = require(process.argv[1]);
  const options = JSON.parse(process.argv[2]);
  const patterns = JSON.parse(process.argv[3]);
  for (const pattern of patterns) {
    for (const compile of [picomatch, picomatch.makeRe, picomatch.parse]) {
      let rejected = false;
      try {
        const result = compile(pattern, options);
        // An unpatched matcher must not be allowed to hang the test runner.
        // The parent kills this entire isolated process after a fixed bound.
        if (typeof result === "function") result("a".repeat(80) + "!");
        else if (result instanceof RegExp) result.test("a".repeat(80) + "!");
      } catch (error) {
        assert(error instanceof SyntaxError);
        assert.match(error.message, /Repeated extglobs are disabled by the SteamBee picomatch security patch/);
        rejected = true;
      }
      assert.equal(rejected, true, pattern);
    }
  }
`;

for (const options of [
  {},
  { fastpaths: false },
  { capture: true },
  { maxExtglobRecursion: false },
  { maxExtglobRecursion: 0 },
  { maxExtglobRecursion: 10000, capture: true },
]) {
  test(`repeated extglobs fail closed within a bounded child process: ${JSON.stringify(options)}`, () => {
    for (const entry of entries) {
      const result = spawnSync(
        process.execPath,
        ["-e", child, entry, JSON.stringify(options), JSON.stringify(patterns)],
        {
          timeout: 2500,
          killSignal: "SIGKILL",
          encoding: "utf8",
          maxBuffer: 64 * 1024,
        },
      );
      assert.ifError(result.error);
      assert.equal(result.signal, null, result.stderr);
      assert.equal(result.status, 0, result.stderr);
    }
  });
}

test("ordinary tooling globs and non-repeated extglobs retain matching behavior", () => {
  for (const entry of entries) {
    const picomatch = createRequire(import.meta.url)(entry);
    const sources = picomatch("src/**/*.{ts,tsx}");
    assert.equal(sources("src/index.ts"), true);
    assert.equal(sources("src/views/App.tsx"), true);
    assert.equal(sources("src/index.js"), false);
    assert.equal(picomatch("*.js")(".hidden.js"), false);
    assert.equal(picomatch("*.js", { dot: true })(".hidden.js"), true);
    assert.equal(picomatch("!**/*.test.ts")("src/index.ts"), true);
    assert.equal(picomatch("!**/*.test.ts")("src/index.test.ts"), false);
    assert.equal(picomatch("@(src|test)/*.ts")("src/index.ts"), true);
    assert.equal(picomatch("?(foo).js")("foo.js"), true);
    assert.equal(picomatch("?(foo).js")("bar.js"), false);
    assert.equal(picomatch("!(foo).js")("bar.js"), true);
    assert.equal(picomatch("!(foo).js")("foo.js"), false);
    assert.equal(picomatch.scan("src/**/*.ts").isGlob, true);
    assert.equal(picomatch.scan("src/**/*.ts").base, "src");
    assert.equal(picomatch.makeRe("src/*.ts").test("src/index.ts"), true);
    assert.equal(typeof picomatch.parse("src/*.ts").output, "string");
    assert.equal(picomatch("+(*)b", { noextglob: true })("aaaa!"), false);
  }
});

test("the installed CommonJS package retains its ESM default import", async () => {
  for (const entry of entries) {
    const cjs = createRequire(import.meta.url)(entry);
    const esm = await import(pathToFileURL(entry).href);
    assert.equal(esm.default, cjs);
    assert.equal(esm.default("**/*.js")("lib/index.js"), true);
    assert.throws(() => esm.default("+(*a)b"), {
      name: "SyntaxError",
      message: rejection,
    });
  }
});
