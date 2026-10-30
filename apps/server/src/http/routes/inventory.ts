import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MAX_STEAM_APP_ID } from "@steam-bee/contracts";
import { getAccountOrThrow } from "../../steam/account-repository.js";
import { accountIdParams } from "../../steam/validation.js";
import { cardSets, inventoryMarket } from "../../inventory/runtime.js";
import {
  readMarketPriceSettings,
  writeMarketPriceSettings,
  settingsSchema,
} from "../../inventory/settings.js";
export { cardSets, inventoryMarket } from "../../inventory/runtime.js";
import { requireAuth } from "../plugins.js";
import { recordInfoEventSafely } from "../events.js";
import { operationContext } from "../operation-context.js";
import { inventoryVariantIdPattern } from "../../inventory/price-overview.js";

const assetId = z.string().regex(/^[1-9]\d{0,24}$/);
const tokenSchema = z.object({ token: z.string().uuid() }).strict();
const marketRateLimit = {
  max: 12,
  timeWindow: "1 minute",
  groupId: "market-actions",
};
const cardSetRateLimit = {
  max: 60,
  timeWindow: "1 minute",
  groupId: "inventory-card-sets",
};
const priceOverviewRateLimit = {
  max: 30,
  timeWindow: "1 minute",
  groupId: "inventory-price-overview",
};

export async function registerInventoryRoutes(app: FastifyInstance) {
  app.get(
    "/api/accounts/:id/inventory",
    { preHandler: requireAuth },
    async (request) => {
      const { id } = accountIdParams.parse(request.params);
      await getAccountOrThrow(id);
      return inventoryMarket.inventory(id);
    },
  );
  app.get(
    "/api/accounts/:id/inventory/card-sets/:appId",
    { preHandler: requireAuth, config: { rateLimit: cardSetRateLimit } },
    async (request) => {
      const { id } = accountIdParams.parse(request.params);
      const { appId } = z
        .object({
          appId: z
            .string()
            .regex(/^[1-9]\d{0,9}$/)
            .transform(Number)
            .refine((value) => value <= MAX_STEAM_APP_ID),
        })
        .parse({ appId: (request.params as { appId?: unknown }).appId });
      await getAccountOrThrow(id);
      return cardSets.get(id, appId);
    },
  );
  app.post(
    "/api/accounts/:id/inventory/price-overview",
    { preHandler: requireAuth, config: { rateLimit: priceOverviewRateLimit } },
    async (request) => {
      const { id } = accountIdParams.parse(request.params);
      const { variantIds } = z
        .object({
          variantIds: z
            .array(z.string().regex(inventoryVariantIdPattern))
            .min(1)
            .max(10)
            .refine(
              (ids) => new Set(ids).size === ids.length,
              "Choose distinct inventory variants.",
            ),
        })
        .strict()
        .parse(request.body);
      await getAccountOrThrow(id);
      return inventoryMarket.priceOverview(id, variantIds);
    },
  );
  app.get(
    "/api/accounts/:id/market/listings",
    { preHandler: requireAuth },
    async (request) => {
      const { id } = accountIdParams.parse(request.params);
      await getAccountOrThrow(id);
      return inventoryMarket.listings(id);
    },
  );
  app.post(
    "/api/accounts/:id/market/preview",
    { preHandler: requireAuth, config: { rateLimit: marketRateLimit } },
    async (request) => {
      const { id } = accountIdParams.parse(request.params);
      const body = z
        .object({ assetId, quantity: z.number().int().min(1).max(100) })
        .strict()
        .parse(request.body);
      await getAccountOrThrow(id);
      return inventoryMarket.previewSale(
        id,
        request.session!.id,
        body.assetId,
        body.quantity,
      );
    },
  );
  app.post(
    "/api/accounts/:id/market/confirm",
    { preHandler: requireAuth, config: { rateLimit: marketRateLimit } },
    async (request) => {
      const { id } = accountIdParams.parse(request.params);
      const { token } = tokenSchema.parse(request.body);
      await getAccountOrThrow(id);
      const result = await inventoryMarket.confirmSale(
        id,
        request.session!.id,
        token,
      );
      await recordInfoEventSafely({
        accountId: id,
        type: "steam.market.listing.create",
        message: result.message,
        metadata: {
          ...operationContext(request, "market-sell"),
          listingId: result.listingId,
          pendingConfirmation: result.pendingConfirmation,
        },
      });
      return result;
    },
  );
  app.post(
    "/api/accounts/:id/market/cancel-preview",
    { preHandler: requireAuth, config: { rateLimit: marketRateLimit } },
    async (request) => {
      const { id } = accountIdParams.parse(request.params);
      const body = z
        .object({ listingId: assetId })
        .strict()
        .parse(request.body);
      await getAccountOrThrow(id);
      return inventoryMarket.previewCancellation(
        id,
        request.session!.id,
        body.listingId,
      );
    },
  );
  app.post(
    "/api/accounts/:id/market/cancel-confirm",
    { preHandler: requireAuth, config: { rateLimit: marketRateLimit } },
    async (request) => {
      const { id } = accountIdParams.parse(request.params);
      const { token } = tokenSchema.parse(request.body);
      await getAccountOrThrow(id);
      const result = await inventoryMarket.confirmCancellation(
        id,
        request.session!.id,
        token,
      );
      await recordInfoEventSafely({
        accountId: id,
        type: "steam.market.listing.cancel",
        message: result.message,
        metadata: {
          ...operationContext(request, "market-cancel"),
          listingId: result.listingId,
        },
      });
      return result;
    },
  );
  app.get(
    "/api/accounts/:id/market/settings",
    { preHandler: requireAuth },
    async (request) => {
      const { id } = accountIdParams.parse(request.params);
      await getAccountOrThrow(id);
      return readMarketPriceSettings(id);
    },
  );
  app.put(
    "/api/accounts/:id/market/settings",
    { preHandler: requireAuth },
    async (request) => {
      const { id } = accountIdParams.parse(request.params);
      const value = settingsSchema.parse(request.body);
      await getAccountOrThrow(id);
      return inventoryMarket.saveSettings(id, value, () =>
        writeMarketPriceSettings(id, value),
      );
    },
  );
  const batchBody = z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("sale"),
        items: z
          .array(
            z
              .object({ assetId, quantity: z.number().int().min(1).max(100) })
              .strict(),
          )
          .min(1)
          .max(50),
      })
      .strict(),
    z
      .object({
        kind: z.literal("cancel"),
        listingIds: z.array(assetId).min(1).max(50),
      })
      .strict(),
  ]);
  app.post(
    "/api/accounts/:id/market/batch-preview",
    { preHandler: requireAuth, config: { rateLimit: marketRateLimit } },
    async (request) => {
      const { id } = accountIdParams.parse(request.params);
      const input = batchBody.parse(request.body);
      await getAccountOrThrow(id);
      return inventoryMarket.previewBatch(id, request.session!.id, input);
    },
  );
  app.post(
    "/api/accounts/:id/market/batch-confirm",
    { preHandler: requireAuth, config: { rateLimit: marketRateLimit } },
    async (request) => {
      const { id } = accountIdParams.parse(request.params);
      const { token } = tokenSchema.parse(request.body);
      await getAccountOrThrow(id);
      const job = inventoryMarket.confirmBatch(id, request.session!.id, token);
      await recordInfoEventSafely({
        accountId: id,
        type: "steam.market.batch.start",
        message: "Confirmed market batch started.",
        metadata: {
          ...operationContext(request, "market-batch"),
          batchId: job.id,
          kind: job.kind,
          totalCount: job.totalCount,
        },
      });
      return job;
    },
  );
  app.get(
    "/api/accounts/:id/market/batches/active",
    { preHandler: requireAuth },
    async (request) => {
      const { id } = accountIdParams.parse(request.params);
      await getAccountOrThrow(id);
      return inventoryMarket.currentBatch(id, request.session!.id);
    },
  );
  const jobParams = z.object({
    id: z.string().uuid(),
    jobId: z.string().uuid(),
  });
  app.get(
    "/api/accounts/:id/market/batches/:jobId",
    { preHandler: requireAuth },
    async (request) => {
      const { id, jobId } = jobParams.parse(request.params);
      await getAccountOrThrow(id);
      return inventoryMarket.getBatch(id, request.session!.id, jobId);
    },
  );
  app.post(
    "/api/accounts/:id/market/batches/:jobId/stop",
    { preHandler: requireAuth },
    async (request) => {
      const { id, jobId } = jobParams.parse(request.params);
      z.object({})
        .strict()
        .parse(request.body ?? {});
      await getAccountOrThrow(id);
      const job = inventoryMarket.stopBatch(id, request.session!.id, jobId);
      await recordInfoEventSafely({
        accountId: id,
        type: "steam.market.batch.stop",
        message: "Market batch stop requested.",
        metadata: {
          ...operationContext(request, "market-batch-stop"),
          batchId: jobId,
        },
      });
      return job;
    },
  );
}
