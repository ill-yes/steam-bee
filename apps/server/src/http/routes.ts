import type { FastifyInstance } from "fastify";
import { registerAccountRoutes } from "./routes/accounts.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAutomationRoutes } from "./routes/automation.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerOperationsRoutes } from "./routes/operations.js";

export async function registerRoutes(app: FastifyInstance) {
  await registerAuthRoutes(app);
  registerAdminRoutes(app);
  await registerAccountRoutes(app);
  await registerAutomationRoutes(app);
  await registerOperationsRoutes(app);
  await registerSystemRoutes(app);
}
