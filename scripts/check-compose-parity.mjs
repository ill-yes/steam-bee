import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectComposeInterpolationVariables,
  isolateComposeEnvironment,
} from "./compose-environment.mjs";
import {
  assertComposeHardening,
  assertComposeParity,
  normalizeComposeService,
} from "./compose-policy.mjs";

const composeFiles = ["compose.yml", "compose.image.yml"];
const composeVariables = collectComposeInterpolationVariables(
  composeFiles.map((path) => readFileSync(path, "utf8")),
);
const composeEnvironment = isolateComposeEnvironment(
  process.env,
  composeVariables,
);
const temporaryDirectory = mkdtempSync(join(tmpdir(), "steam-bee-compose-"));
const emptyEnvironmentFile = join(temporaryDirectory, "empty.env");
writeFileSync(emptyEnvironmentFile, "");

try {
  checkComposeParity();
} catch (error) {
  process.exitCode = 1;
  process.stderr.write(
    `${error instanceof Error ? error.message : "Compose parity check failed."}\n`,
  );
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

function checkComposeParity() {
  const source = composeConfig(["config", "--format", "json"]);
  const prebuilt = composeConfig([
    "-f",
    "compose.image.yml",
    "config",
    "--format",
    "json",
  ]);

  const sourceService = normalizeComposeService(source.services["steam-bee"]);
  const imageService = normalizeComposeService(prebuilt.services["steam-bee"]);

  assertComposeHardening(sourceService, "compose.yml");
  assertComposeHardening(imageService, "compose.image.yml");
  assertComposeParity(sourceService, imageService);

  process.stdout.write("Compose runtime settings are in parity.\n");
}

function composeConfig(args) {
  return JSON.parse(
    execFileSync(
      "docker",
      ["compose", "--env-file", emptyEnvironmentFile, ...args],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: composeEnvironment,
      },
    ),
  );
}
