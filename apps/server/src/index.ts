import { instanceLease } from "./runtime-instance-lease.js";
import {
  buildWithLeaseCleanup,
  createRuntimeShutdown,
  listenWithLeaseCleanup,
} from "./startup.js";

instanceLease.acquire();
const runtime = await buildWithLeaseCleanup(async () => {
  const { buildApp } = await import("./app.js");
  const app = await buildApp();
  const { config } = await import("./config.js");
  const { steamManager } = await import("./steam/manager.js");
  return { app, config, steamManager };
}, instanceLease);
const { app, config, steamManager } = runtime;

instanceLease.onLost(() => {
  app.log.error("DATA_DIR instance lease was lost; terminating immediately");
  process.exit(1);
});

const close = createRuntimeShutdown(
  app,
  instanceLease,
  () =>
    app.log.error(
      "Runtime shutdown failed; retaining the data lease until process exit",
    ),
  (code) => process.exit(code),
  () => steamManager.beginShutdown(true),
);

process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());

await listenWithLeaseCleanup(app, instanceLease, {
  host: config.host,
  port: config.port,
});
