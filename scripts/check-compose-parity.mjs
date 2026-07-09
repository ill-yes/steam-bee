import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";

const image = "ghcr.io/ill-yes/steam-bee:parity-check";
const source = composeConfig(["config", "--format", "json"]);
const prebuilt = composeConfig(
  ["-f", "compose.image.yml", "config", "--format", "json"],
  { STEAM_BEE_IMAGE: image },
);

const sourceService = normalize(source.services["steam-bee"]);
const imageService = normalize(prebuilt.services["steam-bee"]);

assertHardening(sourceService, "compose.yml");
assertHardening(imageService, "compose.image.yml");

if (!isDeepStrictEqual(sourceService, imageService)) {
  process.stderr.write(
    `Compose runtime settings differ.\n\nsource:\n${JSON.stringify(sourceService, null, 2)}\n\nimage:\n${JSON.stringify(imageService, null, 2)}\n`,
  );
  process.exit(1);
}

process.stdout.write("Compose runtime settings are in parity.\n");

function composeConfig(args, extraEnv = {}) {
  return JSON.parse(
    execFileSync("docker", ["compose", ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, ...extraEnv },
    }),
  );
}

function normalize(service) {
  const copy = structuredClone(service);
  delete copy.build;
  delete copy.image;
  return copy;
}

function assertHardening(service, filename) {
  if (
    service.user !== "10001:10001" ||
    service.pids_limit !== 256 ||
    !isDeepStrictEqual(service.cap_drop, ["ALL"]) ||
    service.cap_add !== undefined
  ) {
    process.stderr.write(
      `${filename} must enforce the runtime user, PID limit, and drop all capabilities.\n`,
    );
    process.exit(1);
  }
}
