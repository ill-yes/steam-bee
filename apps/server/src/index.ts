import { instanceLease } from "./runtime-instance-lease.js";
import {
  buildWithLeaseCleanup,
  closeWithLeaseCleanup,
  listenWithLeaseCleanup,
} from "./startup.js";

instanceLease.acquire();
const runtime = await buildWithLeaseCleanup(async () => {
  const { buildApp } = await import("./app.js");
  const app = await buildApp();
  const { config } = await import("./config.js");
  return { app, config };
}, instanceLease);
const { app, config } = runtime;

instanceLease.onLost((error) => {
  app.log.error(error, "DATA_DIR instance lease was lost");
  void closeWithLeaseCleanup(app, instanceLease).finally(() => {
    process.exitCode = 1;
  });
});

const close = async () => {
  await closeWithLeaseCleanup(app, instanceLease);
  process.exit(0);
};

process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());

await listenWithLeaseCleanup(app, instanceLease, {
  host: config.host,
  port: config.port,
});
