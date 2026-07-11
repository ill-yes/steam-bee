import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, migrate, sqlite } from "../src/db/client.js";
import { steamAccount } from "../src/db/schema.js";
import { steamManager } from "../src/steam/manager.js";

describe("SteamManager account operations", () => {
  beforeEach(async () => {
    await steamManager.shutdown();
    migrate();
    sqlite.exec(`
      DELETE FROM steam_event;
      DELETE FROM boost_schedule;
      DELETE FROM boost_preset_game;
      DELETE FROM boost_preset;
      DELETE FROM steam_account;
    `);
  });

  it("serializes worker cleanup and database deletion behind prior account work", async () => {
    const accountId = crypto.randomUUID();
    const now = Date.now();
    await db.insert(steamAccount).values({
      id: accountId,
      accountName: "serialized-delete",
      steamId: null,
      status: "disconnected",
      desiredState: "stopped",
      personaState: 7,
      customTitle: null,
      tokenExpiresAt: null,
      lastError: null,
      latestBoostStartedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    let enterOperation = () => {};
    let releaseOperation = () => {};
    const entered = new Promise<void>((resolve) => {
      enterOperation = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseOperation = resolve;
    });
    const priorOperation = steamManager.runAccountOperation(
      accountId,
      async () => {
        enterOperation();
        await gate;
      },
    );
    await entered;

    const deletion = steamManager.deleteAccount(accountId, {
      source: "test",
      action: "account-delete",
    });
    await Promise.resolve();

    expect(await findAccount(accountId)).toBeDefined();

    releaseOperation();
    await Promise.all([priorOperation, deletion]);
    expect(await findAccount(accountId)).toBeUndefined();
  });
});

async function findAccount(accountId: string) {
  const [account] = await db
    .select()
    .from(steamAccount)
    .where(eq(steamAccount.id, accountId));
  return account;
}
