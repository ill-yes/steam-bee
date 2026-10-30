import type { FastifyInstance } from "fastify";
import { requireAuth } from "../plugins.js";
import { getAccountOrThrow } from "../../steam/account-repository.js";
import { steamManager } from "../../steam/manager.js";
import { accountIdParams } from "../../steam/validation.js";
import {
  farmingConfigSchema,
  farmingController,
  readFarmingConfig,
  saveFarmingConfig,
} from "../../farming/service.js";
import { appError } from "../errors.js";

const actionLimit = { max: 6, timeWindow: "1 minute", groupId: "card-farming" };

export async function registerFarmingRoutes(app: FastifyInstance) {
  app.get(
    "/api/accounts/:id/farming",
    { preHandler: requireAuth },
    async (request) => {
      const { id } = accountIdParams.parse(request.params);
      await getAccountOrThrow(id);
      const settings = await readFarmingConfig(id);
      const availability = await steamManager.getFarmingAvailability(id);
      const snapshot = farmingController.snapshot(id, settings);
      return {
        ...snapshot,
        canStart: availability.allowed || availability.resumable,
        gameLimit: availability.gameLimit,
        reason:
          snapshot.reason ??
          (availability.resumable ? null : availability.reason),
      };
    },
  );

  app.put(
    "/api/accounts/:id/farming/config",
    { preHandler: requireAuth },
    async (request) => {
      const { id } = accountIdParams.parse(request.params);
      const settings = farmingConfigSchema.parse(request.body);
      await getAccountOrThrow(id);
      await saveFarmingConfig(id, settings);
      return farmingController.reconfigure(id, settings);
    },
  );

  app.post(
    "/api/accounts/:id/farming/scan",
    {
      preHandler: requireAuth,
      config: { rateLimit: actionLimit },
    },
    async (request) => {
      const { id } = accountIdParams.parse(request.params);
      const intent = farmingController.captureIntent(id);
      await getAccountOrThrow(id);
      try {
        return await farmingController.scan(
          id,
          await readFarmingConfig(id),
          intent,
        );
      } catch {
        throw appError(
          "Steam badge lookup failed. Check the connected Steam Community session.",
          502,
        );
      }
    },
  );

  app.post(
    "/api/accounts/:id/farming/start",
    {
      preHandler: requireAuth,
      config: { rateLimit: actionLimit },
    },
    async (request) => {
      const { id } = accountIdParams.parse(request.params);
      await getAccountOrThrow(id);
      let availability = await steamManager.getFarmingAvailability(id);
      if (!availability.allowed && availability.resumable)
        availability = await steamManager.resumeForFarming(id, {
          source: "manual",
          action: "farming-start",
        });
      const intent = farmingController.captureIntent(id);
      if (!availability.allowed)
        throw appError(
          "Start the Steam session and clear its safety holds before card farming.",
          409,
        );
      if (
        ["scanning", "warming", "farming"].includes(
          farmingController.snapshot(id).phase,
        )
      ) {
        throw appError("Card farming is already active.", 409);
      }
      return farmingController.start(id, await readFarmingConfig(id), intent);
    },
  );

  // Stop is deliberately exempt from the start/scan rate limit.
  app.post(
    "/api/accounts/:id/farming/stop",
    { preHandler: requireAuth },
    async (request) => {
      const { id } = accountIdParams.parse(request.params);
      await getAccountOrThrow(id);
      return farmingController.stop(id);
    },
  );
}
