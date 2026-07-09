import { config } from "./config.js";
import { buildApp } from "./app.js";

const app = await buildApp();

const close = async () => {
  await app.close();
  process.exit(0);
};

process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());

await app.listen({ host: config.host, port: config.port });
