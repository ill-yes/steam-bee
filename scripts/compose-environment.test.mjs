import assert from "node:assert/strict";
import test from "node:test";
import {
  collectComposeInterpolationVariables,
  isolateComposeEnvironment,
} from "./compose-environment.mjs";

test("compose interpolation variables are discovered across files", () => {
  const variables = collectComposeInterpolationVariables([
    'ports: ["${BIND:-127.0.0.1}:${PORT-3000}:3000"]',
    'image: "${IMAGE:?required}"\nname: "$PROJECT"',
  ]);

  assert.deepEqual([...variables].sort(), ["BIND", "IMAGE", "PORT", "PROJECT"]);
});

test("compose checks ignore local overrides without masking file defaults", () => {
  const variables = new Set(["STEAM_BEE_BIND", "STEAM_BEE_PORT"]);
  const isolated = isolateComposeEnvironment(
    {
      PATH: "/usr/bin",
      DOCKER_HOST: "unix:///var/run/docker.sock",
      COMPOSE_FILE: "local-compose.yml",
      COMPOSE_PROJECT_NAME: "local-project",
      STEAM_BEE_BIND: "0.0.0.0",
      STEAM_BEE_PORT: "8080",
    },
    variables,
  );

  assert.equal(isolated.PATH, "/usr/bin");
  assert.equal(isolated.DOCKER_HOST, "unix:///var/run/docker.sock");
  assert.equal(isolated.COMPOSE_DISABLE_ENV_FILE, "true");
  assert.equal(isolated.COMPOSE_FILE, undefined);
  assert.equal(isolated.COMPOSE_PROJECT_NAME, undefined);
  assert.equal(isolated.STEAM_BEE_BIND, undefined);
  assert.equal(isolated.STEAM_BEE_PORT, undefined);
});
