import { sqlite } from "../db/client.js";
import type { OwnedApp } from "./types.js";

const writeChunkSize = 100;

type LibraryMeta = {
  favorite: boolean;
  hidden: boolean;
  tagsJson: string;
};

type PresetValues = {
  name: string;
  personaState: number;
  customTitle: string | null;
  appIds: number[];
};

export function replaceSelectedGames(input: {
  accountId: string;
  appIds: number[];
  source: "manual" | "preset";
  activePresetId: string | null;
  personaState?: number;
  customTitle?: string | null;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const replace = sqlite.transaction(() => {
    sqlite
      .prepare("DELETE FROM steam_account_game WHERE account_id = ?")
      .run(input.accountId);

    const insertGame = sqlite.prepare(`
      INSERT INTO steam_account_game (
        account_id, app_id, enabled, source, created_at
      ) VALUES (?, ?, 1, ?, ?)
    `);
    const insertCache = sqlite.prepare(`
      INSERT INTO steam_app_cache (
        app_id, name, source, updated_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(app_id) DO NOTHING
    `);

    for (const appIds of chunks(input.appIds, writeChunkSize)) {
      for (const appId of appIds) {
        insertGame.run(input.accountId, appId, input.source, now);
        insertCache.run(appId, `App ${appId}`, input.source, now);
      }
    }

    sqlite
      .prepare(
        `
          UPDATE steam_account
          SET active_preset_id = ?,
              persona_state = COALESCE(?, persona_state),
              custom_title = CASE WHEN ? = 1 THEN ? ELSE custom_title END,
              updated_at = ?
          WHERE id = ?
        `,
      )
      .run(
        input.activePresetId,
        input.personaState ?? null,
        input.customTitle !== undefined ? 1 : 0,
        input.customTitle ?? null,
        now,
        input.accountId,
      );
  });
  replace();
}

export function createPresetRecord(
  presetId: string,
  accountId: string,
  values: PresetValues,
  now = Date.now(),
) {
  const create = sqlite.transaction(() => {
    sqlite
      .prepare(
        `
          INSERT INTO boost_preset (
            id, account_id, name, persona_state, custom_title, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        presetId,
        accountId,
        values.name,
        values.personaState,
        values.customTitle,
        now,
        now,
      );
    insertPresetGames(presetId, values.appIds, now);
  });
  create();
}

export function updatePresetRecord(
  presetId: string,
  accountId: string,
  values: PresetValues,
  now = Date.now(),
) {
  const update = sqlite.transaction(() => {
    sqlite
      .prepare(
        `
          UPDATE boost_preset
          SET name = ?, persona_state = ?, custom_title = ?, updated_at = ?
          WHERE id = ? AND account_id = ?
        `,
      )
      .run(
        values.name,
        values.personaState,
        values.customTitle,
        now,
        presetId,
        accountId,
      );
    sqlite
      .prepare("DELETE FROM boost_preset_game WHERE preset_id = ?")
      .run(presetId);
    insertPresetGames(presetId, values.appIds, now);
    sqlite
      .prepare(
        `
          UPDATE steam_account
          SET active_preset_id = NULL, updated_at = ?
          WHERE id = ? AND active_preset_id = ?
        `,
      )
      .run(now, accountId, presetId);
  });
  update();
}

export function replaceAccountLibrary(
  accountId: string,
  apps: OwnedApp[],
  previousMeta: Map<number, LibraryMeta>,
  now = Date.now(),
) {
  const replace = sqlite.transaction(() => {
    sqlite
      .prepare("DELETE FROM steam_account_library WHERE account_id = ?")
      .run(accountId);

    const upsertCache = sqlite.prepare(`
      INSERT INTO steam_app_cache (
        app_id, name, playtime_forever, source, updated_at
      ) VALUES (?, ?, ?, 'library', ?)
      ON CONFLICT(app_id) DO UPDATE SET
        name = excluded.name,
        playtime_forever = excluded.playtime_forever,
        source = excluded.source,
        updated_at = excluded.updated_at
    `);
    const insertLibrary = sqlite.prepare(`
      INSERT INTO steam_account_library (
        account_id, app_id, playtime_forever, source,
        favorite, hidden, tags_json, imported_at
      ) VALUES (?, ?, ?, 'library', ?, ?, ?, ?)
    `);

    for (const appChunk of chunks(apps, writeChunkSize)) {
      for (const app of appChunk) {
        upsertCache.run(app.appId, app.name, app.playtimeForever, now);
        const meta = previousMeta.get(app.appId);
        insertLibrary.run(
          accountId,
          app.appId,
          app.playtimeForever,
          meta?.favorite ? 1 : 0,
          meta?.hidden ? 1 : 0,
          meta?.tagsJson ?? "[]",
          now,
        );
      }
    }
  });
  replace();
}

function insertPresetGames(presetId: string, appIds: number[], now: number) {
  const insert = sqlite.prepare(`
    INSERT INTO boost_preset_game (preset_id, app_id, created_at)
    VALUES (?, ?, ?)
  `);
  for (const appIdChunk of chunks(appIds, writeChunkSize)) {
    for (const appId of appIdChunk) insert.run(presetId, appId, now);
  }
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}
