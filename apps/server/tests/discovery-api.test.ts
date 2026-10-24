import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { db, migrate, sqlite } from "../src/db/client.js";
import { steamAccount } from "../src/db/schema.js";
import { freeGamesService } from "../src/discovery/service.js";
import {
  getAccountHealth,
  getAccountOperationMaps,
} from "../src/steam/operations-repository.js";
import { replaceAccountLibrary } from "../src/steam/repository.js";

describe("free offers API", () => {
  beforeEach(() => {
    migrate();
    sqlite.exec(
      "DELETE FROM steam_account; DELETE FROM admin_session; DELETE FROM admin_user;",
    );
    vi.restoreAllMocks();
  });

  it("requires authentication and filters only the selected account's imported ownership", async () => {
    const upstream = vi.spyOn(freeGamesService, "getOffers").mockResolvedValue({
      offers: [
        {
          appId: 42,
          name: "Owned",
          storeUrl: "https://store.steampowered.com/app/42/",
        },
        {
          appId: 43,
          name: "New",
          storeUrl: "https://store.steampowered.com/app/43/",
        },
      ],
      checkedAt: 50_000,
      stale: false,
      truncated: false,
    });
    const app = await buildApp({ initSteam: false });
    try {
      const accountId = randomUUID();
      const unauthenticated = await app.inject({
        method: "GET",
        url: `/api/accounts/${accountId}/free-games`,
      });
      expect(unauthenticated.statusCode).toBe(401);
      expect(upstream).not.toHaveBeenCalled();
      const setup = await app.inject({
        method: "POST",
        url: "/api/setup",
        payload: {
          password: "correct horse battery staple",
          setupToken: "steam-bee-test-setup-token",
        },
      });
      const cookies = {
        session: setup.cookies.find((cookie) => cookie.name === "session")!
          .value,
      };
      const invalid = await app.inject({
        method: "GET",
        url: "/api/accounts/not-a-uuid/free-games",
        cookies,
      });
      expect(invalid.statusCode).toBe(400);
      const missing = await app.inject({
        method: "GET",
        url: `/api/accounts/${accountId}/free-games`,
        cookies,
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toMatchObject({ code: "ACCOUNT_NOT_FOUND" });
      expect(upstream).not.toHaveBeenCalled();
      await db.insert(steamAccount).values({
        id: accountId,
        accountName: "offer-account",
        status: "disconnected",
        desiredState: "stopped",
        tokenKeyVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      const freshAccount = await app.inject({
        method: "GET",
        url: `/api/accounts/${accountId}/free-games`,
        cookies,
      });
      expect(freshAccount.json()).toMatchObject({
        offers: [{ appId: 42 }, { appId: 43 }],
        libraryImportedAt: null,
        excludedOwnedCount: 0,
        region: "US",
      });
      replaceAccountLibrary(
        accountId,
        [{ appId: 42, name: "Owned", playtimeForever: 0 }],
        new Map(),
        100,
      );
      const otherAccountId = randomUUID();
      await db.insert(steamAccount).values({
        id: otherAccountId,
        accountName: "other-offer-account",
        status: "disconnected",
        desiredState: "stopped",
        tokenKeyVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      replaceAccountLibrary(
        otherAccountId,
        [{ appId: 43, name: "Other account owns this", playtimeForever: 0 }],
        new Map(),
        200,
      );
      const filtered = await app.inject({
        method: "GET",
        url: `/api/accounts/${accountId}/free-games`,
        cookies,
      });
      expect(filtered.statusCode).toBe(200);
      expect(filtered.json()).toMatchObject({
        offers: [{ appId: 43 }],
        libraryImportedAt: 100,
        excludedOwnedCount: 1,
      });
      expect(filtered.json().offers).toHaveLength(1);
      expect(filtered.headers["cache-control"]).toBe("no-store");

      replaceAccountLibrary(accountId, [], new Map(), 300);
      const emptyImported = await app.inject({
        method: "GET",
        url: `/api/accounts/${accountId}/free-games`,
        cookies,
      });
      expect(emptyImported.statusCode).toBe(200);
      expect(emptyImported.json()).toMatchObject({
        offers: [{ appId: 42 }, { appId: 43 }],
        libraryImportedAt: 300,
        excludedOwnedCount: 0,
      });
      expect((await getAccountHealth(accountId)).libraryImportedAt).toBe(300);
      expect(
        (await getAccountOperationMaps([accountId])).health.get(accountId)
          ?.libraryImportedAt,
      ).toBe(300);
    } finally {
      await app.close();
    }
  });
});
