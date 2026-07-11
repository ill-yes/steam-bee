import { isDeepStrictEqual } from "node:util";

export function normalizeComposeService(service) {
  const normalized = structuredClone(service);
  delete normalized.build;
  delete normalized.image;
  return normalized;
}

export function assertComposeHardening(service, filename) {
  if (
    service.init !== true ||
    service.read_only !== true ||
    service.restart !== "unless-stopped" ||
    service.user !== "10001:10001" ||
    service.pids_limit !== 256 ||
    !isDeepStrictEqual(service.cap_drop, ["ALL"]) ||
    service.cap_add !== undefined ||
    !isDeepStrictEqual(service.security_opt, ["no-new-privileges:true"]) ||
    !isDeepStrictEqual(service.tmpfs, ["/tmp:rw,noexec,nosuid,size=64m"]) ||
    service.stop_grace_period !== "30s" ||
    !isDeepStrictEqual(service.logging, {
      driver: "json-file",
      options: { "max-file": "3", "max-size": "10m" },
    }) ||
    service.ports?.length !== 1 ||
    service.ports[0]?.host_ip !== "127.0.0.1" ||
    service.ports[0]?.target !== 3000 ||
    service.ports[0]?.published !== "3000" ||
    service.healthcheck?.retries !== 3 ||
    service.healthcheck?.interval !== "30s" ||
    service.healthcheck?.timeout !== "5s" ||
    service.healthcheck?.start_period !== "20s"
  ) {
    throw new Error(
      `${filename} does not match the reviewed runtime hardening baseline.`,
    );
  }
}

export function assertComposeParity(sourceService, imageService) {
  if (!isDeepStrictEqual(sourceService, imageService)) {
    throw new Error(
      `Compose runtime settings differ.\n\nsource:\n${JSON.stringify(sourceService, null, 2)}\n\nimage:\n${JSON.stringify(imageService, null, 2)}`,
    );
  }
}
