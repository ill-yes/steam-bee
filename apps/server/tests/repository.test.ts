import { beforeEach, describe, expect, it } from "vitest";
import { migrate, sqlite } from "../src/db/client.js";
import {
  createPresetRecord,
  replaceAccountLibrary,
  replaceSelectedGames,
} from "../src/steam/repository.js";

const accountId = "11111111-1111-4111-8111-111111111111";

describe("Steam repository transactions", () => {
  beforeEach(() => {
    migrate();
    sqlite.exec(`
      DELETE FROM boost_session;
      DELETE FROM boost_schedule;
      DELETE FROM boost_preset_game;
      DELETE FROM boost_preset;
      DELETE FROM steam_account_library;
      DELETE FROM steam_account_game;
      DELETE FROM steam_app_cache;
      DELETE FROM steam_account;
      INSERT INTO steam_account (
        id, account_name, status, desired_state, persona_state,
        token_key_version, created_at, updated_at
      ) VALUES (
        '${accountId}', 'transaction.runner', 'disconnected', 'stopped', 7,
        1, 1, 1
      );
      INSERT INTO steam_app_cache (app_id, name, source, updated_at)
      VALUES (440, 'Team Fortress 2', 'manual', 1);
      INSERT INTO steam_account_game (account_id, app_id, enabled, source, created_at)
      VALUES ('${accountId}', 440, 1, 'manual', 1);
      INSERT INTO steam_account_library (
        account_id, app_id, playtime_forever, source,
        favorite, hidden, tags_json, imported_at
      ) VALUES ('${accountId}', 440, 10, 'library', 1, 0, '["classic"]', 1);
    `);
  });

  it("rolls back a game replacement when an insert fails", () => {
    expect(() =>
      replaceSelectedGames({
        accountId,
        appIds: [730, 730],
        source: "manual",
        activePresetId: null,
      }),
    ).toThrow();

    expect(selectedGameIds()).toEqual([440]);
  });

  it("rolls back preset creation when a child insert fails", () => {
    expect(() =>
      createPresetRecord("22222222-2222-4222-8222-222222222222", accountId, {
        name: "Broken duplicate",
        personaState: 7,
        customTitle: null,
        appIds: [730, 730],
      }),
    ).toThrow();

    expect(sqlite.prepare("SELECT id FROM boost_preset").all()).toHaveLength(0);
  });

  it("rolls back a library replacement when a duplicate app fails", () => {
    expect(() =>
      replaceAccountLibrary(
        accountId,
        [
          { appId: 730, name: "Counter-Strike 2", playtimeForever: 5 },
          { appId: 730, name: "Counter-Strike 2", playtimeForever: 5 },
        ],
        new Map(),
      ),
    ).toThrow();

    expect(
      sqlite
        .prepare(
          "SELECT app_id as appId, favorite, tags_json as tagsJson FROM steam_account_library WHERE account_id = ?",
        )
        .all(accountId),
    ).toEqual([{ appId: 440, favorite: 1, tagsJson: '["classic"]' }]);
  });
});

function selectedGameIds() {
  return sqlite
    .prepare(
      "SELECT app_id as appId FROM steam_account_game WHERE account_id = ? ORDER BY app_id",
    )
    .all(accountId)
    .map((row) => Number((row as { appId: number }).appId));
}
