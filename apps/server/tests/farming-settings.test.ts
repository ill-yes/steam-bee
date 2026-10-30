import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FARMING_CONFIG } from "@steam-bee/contracts";
import { eq } from "drizzle-orm";
import { db, migrate, sqlite } from "../src/db/client.js";
import {
  accountFarmingConfig,
  steamAccount,
  steamAccountLibrary,
  steamAppCache,
} from "../src/db/schema.js";
import {
  farmingConfigSchema,
  farmingController,
  readFarmingConfig,
  saveFarmingConfig,
} from "../src/farming/service.js";
import * as community from "../src/steam/community.js";
import { steamManager } from "../src/steam/manager.js";

describe("persisted card farming settings", () => {
  let accountId: string;
  beforeEach(async () => {
    migrate();
    accountId = randomUUID();
    await db.insert(steamAccount).values({
      id: accountId,
      accountName: `farming-${accountId}`,
      status: "disconnected",
      desiredState: "stopped",
      tokenKeyVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await db.delete(steamAccount).where(eq(steamAccount.id, accountId));
  });

  it("uses the canonical authenticated profile path and protects rounded badge playtime", async () => {
    await db
      .insert(steamAppCache)
      .values({ appId: 10, name: "Rounded game", updatedAt: 1 })
      .onConflictDoNothing();
    await db
      .insert(steamAccountLibrary)
      .values({ accountId, appId: 10, playtimeForever: 117, importedAt: 1 });
    vi.spyOn(steamManager, "getCommunitySession").mockResolvedValue({
      steamId: "76561198000000000",
      sessionId: "test-session",
      cookies: [],
    });
    const request = vi
      .spyOn(community, "communityRequest")
      .mockResolvedValue(
        new Response(
          `<div class="badges_sheet"><div class="badge_row"><a href="/profiles/76561198000000000/gamecards/10/"></a><div class="badge_title">Rounded game</div><span>2.0 hrs on record</span><span>3 card drops remaining</span></div></div>`,
        ),
      );
    farmingController.initialize();
    const result = await farmingController.scan(
      accountId,
      DEFAULT_FARMING_CONFIG,
    );
    expect(request).toHaveBeenCalledWith(
      accountId,
      "/profiles/76561198000000000/badges/?l=english&p=1",
    );
    expect(result.games[0]).toMatchObject({
      playtimeMinutes: 117,
      skipReason: "purchase_date_unknown",
    });
  });

  it("defaults to refund protection and saves/upserts validated account settings", async () => {
    expect(await readFarmingConfig(accountId)).toEqual(DEFAULT_FARMING_CONFIG);
    await saveFarmingConfig(accountId, {
      ...DEFAULT_FARMING_CONFIG,
      whitelist: [10, 10, 20],
      blacklist: [20],
    });
    expect(await readFarmingConfig(accountId)).toEqual({
      ...DEFAULT_FARMING_CONFIG,
      whitelist: [10, 20],
      blacklist: [20],
    });
    await saveFarmingConfig(accountId, {
      ...DEFAULT_FARMING_CONFIG,
      maxConcurrentGames: 4,
    });
    expect((await readFarmingConfig(accountId)).maxConcurrentGames).toBe(4);
    expect(
      await db
        .select()
        .from(accountFarmingConfig)
        .where(eq(accountFarmingConfig.accountId, accountId)),
    ).toHaveLength(1);
  });

  it("deletes settings with the account and retains malformed data for diagnosis", async () => {
    await saveFarmingConfig(accountId, DEFAULT_FARMING_CONFIG);
    sqlite
      .prepare(
        "UPDATE account_farming_config SET config_json = ? WHERE account_id = ?",
      )
      .run("invalid-json", accountId);
    await expect(readFarmingConfig(accountId)).rejects.toThrow(
      /could not be read/,
    );
    expect(
      (
        await db
          .select()
          .from(accountFarmingConfig)
          .where(eq(accountFarmingConfig.accountId, accountId))
      )[0]?.configJson,
    ).toBe("invalid-json");
    await db.delete(steamAccount).where(eq(steamAccount.id, accountId));
    expect(
      await db
        .select()
        .from(accountFarmingConfig)
        .where(eq(accountFarmingConfig.accountId, accountId)),
    ).toHaveLength(0);
  });

  it("rejects invalid ids, unbounded settings, and unknown fields", () => {
    for (const input of [
      { ...DEFAULT_FARMING_CONFIG, maxConcurrentGames: 33 },
      { ...DEFAULT_FARMING_CONFIG, whitelist: [0] },
      { ...DEFAULT_FARMING_CONFIG, blacklist: Array(501).fill(10) },
      { ...DEFAULT_FARMING_CONFIG, autoStart: true },
    ])
      expect(farmingConfigSchema.safeParse(input).success).toBe(false);
  });
});
