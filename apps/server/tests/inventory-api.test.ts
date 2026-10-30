import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { db, migrate } from "../src/db/client.js";
import { DEFAULT_MARKET_PRICE_SETTINGS } from "@steam-bee/contracts";
import { steamAccount } from "../src/db/schema.js";
import { inventoryMarket } from "../src/http/routes/inventory.js";

const accountId = "7e9cc647-a176-486c-9276-e14fa131c480";
afterEach(() => vi.restoreAllMocks());

describe("inventory and financial route access", () => {
  it("requires authentication, CSRF and strict body validation before reaching market services", async () => {
    migrate();
    const app = await buildApp({ initSteam: false });
    const sale = vi
      .spyOn(inventoryMarket, "previewSale")
      .mockRejectedValue(new Error("must never reach the upstream"));
    try {
      for (const path of [
        "inventory",
        "inventory/card-sets/10",
        "market/listings",
        "market/settings",
        "market/batches/active",
        `market/batches/${crypto.randomUUID()}`,
      ]) {
        const response = await app.inject({
          method: "GET",
          url: `/api/accounts/${accountId}/${path}`,
        });
        expect(response.statusCode).toBe(401);
      }
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/accounts/${accountId}/inventory/price-overview`,
            payload: { variantIds: ["753:6:10:0"] },
          })
        ).statusCode,
      ).toBe(401);
      const setup = await app.inject({
        method: "POST",
        url: "/api/setup",
        payload: {
          password: "correct horse battery staple",
          setupToken: "steam-bee-test-setup-token",
        },
      });
      expect(setup.statusCode).toBe(200);
      const cookies = {
        session: setup.cookies.find((cookie) => cookie.name === "session")!
          .value,
      };
      const headers = {
        "x-csrf-token": setup.json<{ csrfToken: string }>().csrfToken,
      };
      const now = Date.now();
      await db.insert(steamAccount).values({
        id: accountId,
        accountName: "inventory-route-test",
        status: "disconnected",
        desiredState: "stopped",
        personaState: 7,
        tokenKeyVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      const overview = vi.spyOn(inventoryMarket, "priceOverview");
      const pricePath = `/api/accounts/${accountId}/inventory/price-overview`;
      expect(
        (
          await app.inject({
            method: "POST",
            url: pricePath,
            cookies,
            payload: { variantIds: ["753:6:10:0"] },
          })
        ).statusCode,
      ).toBe(403);
      for (const payload of [
        { variantIds: [] },
        { variantIds: ["753:6:10:0", "753:6:10:0"] },
        {
          variantIds: Array.from(
            { length: 11 },
            (_, index) => `753:6:${index + 1}:0`,
          ),
        },
        { variantIds: ["../../../market"] },
        { variantIds: ["753:6:10:0"], marketHashName: "A foreign item" },
      ]) {
        expect(
          (
            await app.inject({
              method: "POST",
              url: pricePath,
              cookies,
              headers,
              payload,
            })
          ).statusCode,
        ).toBe(400);
      }
      expect(overview).not.toHaveBeenCalled();
      const expiredContext = await app.inject({
        method: "POST",
        url: pricePath,
        cookies,
        headers,
        payload: { variantIds: ["753:6:10:0"] },
      });
      expect(expiredContext.statusCode).toBe(409);
      expect(expiredContext.json()).toMatchObject({
        code: "INVENTORY_PRICE_CONTEXT_EXPIRED",
      });
      for (const action of [
        "preview",
        "confirm",
        "cancel-preview",
        "cancel-confirm",
      ]) {
        const response = await app.inject({
          method: "POST",
          url: `/api/accounts/${accountId}/market/${action}`,
          cookies,
          payload: { token: crypto.randomUUID() },
        });
        expect(response.statusCode).toBe(403);
        expect(response.json()).toMatchObject({ code: "CSRF_INVALID" });
      }
      for (const payload of [
        { assetId: "100", quantity: -1 },
        { assetId: "100", quantity: 1, price: 1 },
        { assetId: "../foreign", quantity: 1 },
      ]) {
        const response = await app.inject({
          method: "POST",
          url: `/api/accounts/${accountId}/market/preview`,
          cookies,
          headers,
          payload,
        });
        expect(response.statusCode).toBe(400);
      }
      const settings = await app.inject({
        method: "GET",
        url: `/api/accounts/${accountId}/market/settings`,
        cookies,
      });
      expect(settings.statusCode).toBe(200);
      expect(settings.json()).toEqual(DEFAULT_MARKET_PRICE_SETTINGS);
      const active = await app.inject({
        method: "GET",
        url: `/api/accounts/${accountId}/market/batches/active`,
        cookies,
      });
      expect(active.statusCode).toBe(200);
      expect(active.json()).toBeNull();
      const missing = await app.inject({
        method: "GET",
        url: `/api/accounts/${accountId}/market/batches/${crypto.randomUUID()}`,
        cookies,
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toMatchObject({ code: "NOT_FOUND" });
      const invalidSettings = await app.inject({
        method: "PUT",
        url: `/api/accounts/${accountId}/market/settings`,
        cookies,
        headers,
        payload: { ...DEFAULT_MARKET_PRICE_SETTINGS, adjustment: 0.01 },
      });
      expect(invalidSettings.statusCode).toBe(400);
      const missingCsrfSettings = await app.inject({
        method: "PUT",
        url: `/api/accounts/${accountId}/market/settings`,
        cookies,
        payload: DEFAULT_MARKET_PRICE_SETTINGS,
      });
      expect(missingCsrfSettings.statusCode).toBe(403);
      const batchPreview = vi.spyOn(inventoryMarket, "previewBatch");
      for (const payload of [
        {
          kind: "sale",
          items: Array.from({ length: 51 }, () => ({
            assetId: "100",
            quantity: 1,
          })),
        },
        { kind: "sale", items: [{ assetId: "100", quantity: 1 }], price: 1 },
        { kind: "cancel", listingIds: ["../foreign"] },
      ]) {
        const response = await app.inject({
          method: "POST",
          url: `/api/accounts/${accountId}/market/batch-preview`,
          cookies,
          headers,
          payload,
        });
        expect(response.statusCode).toBe(400);
      }
      expect(batchPreview).not.toHaveBeenCalled();
      expect(sale).not.toHaveBeenCalled();
      overview.mockResolvedValue({
        accountId,
        inventoryFetchedAt: now,
        currency: null,
        priceMode: "lowestSellOrder",
        rulesFingerprint: "fixture",
        walletFingerprint: null,
        rows: [],
      });
      for (let index = 0; index < 31; index++) {
        const response = await app.inject({
          method: "POST",
          url: pricePath,
          cookies,
          headers,
          remoteAddress: "203.0.113.55",
          payload: { variantIds: ["753:6:10:0"] },
        });
        expect(response.statusCode).toBe(index < 30 ? 200 : 429);
      }
      const financialValidation = await app.inject({
        method: "POST",
        url: `/api/accounts/${accountId}/market/preview`,
        cookies,
        headers,
        remoteAddress: "203.0.113.55",
        payload: { assetId: "100", quantity: -1 },
      });
      expect(financialValidation.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
