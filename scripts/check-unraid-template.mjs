import { readFileSync } from "node:fs";

const template = readFileSync("templates/steam-bee.xml", "utf8");
const extraParams = readTag("ExtraParams").split(/\s+/).filter(Boolean);
const expectedParams = [
  "--entrypoint=/usr/local/bin/steam-bee-entrypoint",
  "--user=0:0",
  "--pids-limit=256",
  "--cap-drop=ALL",
  "--cap-add=CHOWN",
  "--cap-add=DAC_READ_SEARCH",
  "--cap-add=SETGID",
  "--cap-add=SETPCAP",
  "--cap-add=SETUID",
  "--security-opt=no-new-privileges=true",
  "--read-only",
  "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=64m",
  "--stop-timeout=30",
  "--log-opt=max-size=10m",
  "--log-opt=max-file=3",
];

if (
  extraParams.length !== expectedParams.length ||
  extraParams.some((param, index) => param !== expectedParams[index])
) {
  fail(
    `ExtraParams must exactly match the reviewed runtime policy.\nExpected: ${expectedParams.join(" ")}\nReceived: ${extraParams.join(" ")}`,
  );
}

assertConfig("PUID", { Default: "99", Required: "true" });
assertConfig("PGID", { Default: "100", Required: "true" });
assertConfig("STEAM_BEE_DATA_INIT", {
  Default: "true",
  Required: "true",
});

if (readTag("Privileged") !== "false") {
  fail("The Unraid container must not run in privileged mode.");
}

if (readTag("Repository") !== "ghcr.io/ill-yes/steam-bee:latest") {
  fail("The Unraid repository must track the stable latest image.");
}

if (readTag("PostArgs") !== "node dist/index.js") {
  fail("The Unraid template must pass the SteamBee server command explicitly.");
}

process.stdout.write("Unraid template runtime settings are valid.\n");

function readTag(name) {
  const matches = [
    ...template.matchAll(new RegExp(`<${name}>([^<]+)</${name}>`, "g")),
  ];
  if (matches.length !== 1) {
    fail(`Expected exactly one <${name}> tag, received ${matches.length}.`);
  }
  return matches[0][1].trim();
}

function assertConfig(target, expected) {
  const matches = [
    ...template.matchAll(
      new RegExp(`<Config\\s+[^>]*Target="${target}"[^>]*/>`, "g"),
    ),
  ];
  if (matches.length !== 1) {
    fail(
      `Expected exactly one Config for ${target}, received ${matches.length}.`,
    );
  }

  const attributes = Object.fromEntries(
    [...matches[0][0].matchAll(/([A-Za-z]+)="([^"]*)"/g)].map((item) => [
      item[1],
      item[2],
    ]),
  );

  for (const [name, value] of Object.entries(expected)) {
    if (attributes[name] !== value) {
      fail(`${target} must set ${name}="${value}".`);
    }
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
