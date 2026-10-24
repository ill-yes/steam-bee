import type { FastifyInstance } from "fastify";
import { registerAccountRoutes } from "./routes/accounts.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAutomationRoutes } from "./routes/automation.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerOperationsRoutes } from "./routes/operations.js";
import { registerDiscoveryRoutes } from "./routes/discovery.js";
import { registerInventoryRoutes } from "./routes/inventory.js";
import { registerFarmingRoutes } from "./routes/farming.js";

export async function registerRoutes(app: FastifyInstance) {
  await registerAuthRoutes(app);
  registerAdminRoutes(app);
  await registerAccountRoutes(app);
  await registerAutomationRoutes(app);
  await registerOperationsRoutes(app);
  await registerDiscoveryRoutes(app);
  await registerInventoryRoutes(app);
  await registerFarmingRoutes(app);
  await registerSystemRoutes(app);
}
