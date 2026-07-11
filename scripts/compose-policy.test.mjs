import assert from "node:assert/strict";
import test from "node:test";
import {
  assertComposeHardening,
  assertComposeParity,
  normalizeComposeService,
} from "./compose-policy.mjs";

test("compose hardening accepts the reviewed baseline", () => {
  assert.doesNotThrow(() =>
    assertComposeHardening(reviewedService(), "compose.yml"),
  );
});

test("compose hardening rejects a changed localhost default", () => {
  const service = reviewedService();
  service.ports[0].host_ip = "0.0.0.0";

  assert.throws(
    () => assertComposeHardening(service, "compose.yml"),
    /does not match the reviewed runtime hardening baseline/,
  );
});

test("compose parity ignores image sources but rejects runtime drift", () => {
  const source = normalizeComposeService({
    ...reviewedService(),
    build: { context: "." },
  });
  const image = normalizeComposeService({
    ...reviewedService(),
    image: "ghcr.io/ill-yes/steam-bee:test",
  });
  assert.doesNotThrow(() => assertComposeParity(source, image));

  image.environment = { LOG_LEVEL: "debug" };
  assert.throws(
    () => assertComposeParity(source, image),
    /Compose runtime settings differ/,
  );
});

function reviewedService() {
  return {
    init: true,
    read_only: true,
    restart: "unless-stopped",
    user: "10001:10001",
    pids_limit: 256,
    cap_drop: ["ALL"],
    security_opt: ["no-new-privileges:true"],
    tmpfs: ["/tmp:rw,noexec,nosuid,size=64m"],
    stop_grace_period: "30s",
    logging: {
      driver: "json-file",
      options: { "max-file": "3", "max-size": "10m" },
    },
    ports: [{ host_ip: "127.0.0.1", target: 3000, published: "3000" }],
    healthcheck: {
      retries: 3,
      interval: "30s",
      timeout: "5s",
      start_period: "20s",
    },
  };
}
