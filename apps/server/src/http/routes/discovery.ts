import type { FreeGamesResponse } from "@steam-bee/contracts";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db } from "../../db/client.js";
import { steamAccountLibrary } from "../../db/schema.js";
import { freeGamesService } from "../../discovery/service.js";
import { getAccountOrThrow } from "../../steam/account-repository.js";
import { accountIdParams } from "../../steam/validation.js";
import { requireAuth } from "../plugins.js";

export async function registerDiscoveryRoutes(app: FastifyInstance) {
  app.get(
    "/api/accounts/:id/free-games",
    { preHandler: requireAuth },
    async (request) => {
      const params = accountIdParams.parse(request.params);
      const account = await getAccountOrThrow(params.id);
      const library = await db
        .select({
          appId: steamAccountLibrary.appId,
        })
        .from(steamAccountLibrary)
        .where(eq(steamAccountLibrary.accountId, params.id));
      const ownedIds = new Set(library.map((entry) => entry.appId));
      const result = await freeGamesService.getOffers();
      const offers = result.offers.filter(
        (offer) => !ownedIds.has(offer.appId),
      );
      return {
        ...result,
        offers,
        region: "US",
        libraryImportedAt: account.libraryImportedAt,
        excludedOwnedCount: result.offers.length - offers.length,
      } satisfies FreeGamesResponse;
    },
  );
}
