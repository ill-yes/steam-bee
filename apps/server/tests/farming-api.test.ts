import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FARMING_CONFIG } from "@steam-bee/contracts";
import { buildApp } from "../src/app.js";
import { db, migrate, sqlite } from "../src/db/client.js";
import { steamAccount } from "../src/db/schema.js";
import {
  farmingController,
  readFarmingConfig,
} from "../src/farming/service.js";
import { steamManager } from "../src/steam/manager.js";

describe("card farming API", () => {
  beforeEach(() => {
    migrate();
    sqlite.exec(
      "DELETE FROM steam_account; DELETE FROM admin_session; DELETE FROM admin_user;",
    );
    vi.restoreAllMocks();
  });

  it("requires authentication and CSRF, persists validated settings, and never starts through a safety hold", async () => {
    const accountId = randomUUID();
    const availability = vi
      .spyOn(steamManager, "getFarmingAvailability")
      .mockResolvedValue({ allowed: false, reason: "manual", gameLimit: 31 });
    const start = vi.spyOn(farmingController, "start");
    const app = await buildApp({ initSteam: false });
    try {
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/accounts/${accountId}/farming`,
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
      const cookies = {
        session: setup.cookies.find((cookie) => cookie.name === "session")!
          .value,
      };
      const headers = {
        "x-csrf-token": setup.json<{ csrfToken: string }>().csrfToken,
      };
      await db.insert(steamAccount).values({
        id: accountId,
        accountName: `farming-${accountId}`,
        status: "disconnected",
        desiredState: "stopped",
        tokenKeyVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      const status = await app.inject({
        method: "GET",
        url: `/api/accounts/${accountId}/farming`,
        cookies,
      });
      expect(status.json()).toMatchObject({
        canStart: false,
        gameLimit: 31,
        config: DEFAULT_FARMING_CONFIG,
      });
      expect(availability).toHaveBeenCalledWith(accountId);
      expect(
        (
          await app.inject({
            method: "PUT",
            url: `/api/accounts/${accountId}/farming/config`,
            cookies,
            payload: DEFAULT_FARMING_CONFIG,
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: "PUT",
            url: `/api/accounts/${accountId}/farming/config`,
            cookies,
            headers,
            payload: { ...DEFAULT_FARMING_CONFIG, maxConcurrentGames: 33 },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: "PUT",
            url: `/api/accounts/${accountId}/farming/config`,
            cookies,
            headers,
            payload: { ...DEFAULT_FARMING_CONFIG, blacklist: [10] },
          })
        ).statusCode,
      ).toBe(200);
      expect((await readFarmingConfig(accountId)).blacklist).toEqual([10]);
      const starts = [];
      for (let index = 0; index < 7; index += 1)
        starts.push(
          await app.inject({
            method: "POST",
            url: `/api/accounts/${accountId}/farming/start`,
            cookies,
            headers,
          }),
        );
      expect(starts[0]?.statusCode).toBe(409);
      expect(starts.at(-1)?.statusCode).toBe(429);
      expect(start).not.toHaveBeenCalled();
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/accounts/${accountId}/farming/stop`,
            cookies,
            headers,
          })
        ).statusCode,
      ).toBe(200);
    } finally {
      await app.close();
    }
  });
});
