import { beforeEach, describe, expect, it } from "vitest";
import {
  checkDatabaseReady,
  getMigrationState,
  migrate,
  sqlite,
  UnsupportedDatabaseSchemaError,
} from "../src/db/client.js";

const baseTimestamp = 1_735_689_600_000;

describe("database migrations", () => {
  beforeEach(() => {
    resetDatabase();
  });

  it("migrates from the initial schema and preserves existing account data", () => {
    seedInitialSchema();
    seedHistoricalAccount();

    migrate();

    expect(getMigrationState()).toMatchObject({
      current: "010_timed_hold_ownership_provenance",
      latest: "010_timed_hold_ownership_provenance",
      pending: [],
    });
    expect(tableColumns("steam_account")).toContain("active_preset_id");
    expect(tableColumns("steam_account_library")).toEqual(
      expect.arrayContaining(["favorite", "hidden", "tags_json"]),
    );
    expect(tableNames()).toEqual(
      expect.arrayContaining([
        "boost_preset",
        "boost_preset_game",
        "boost_schedule",
        "boost_session",
        "account_health_state",
        "account_safety_policy",
        "schedule_exception",
        "account_group",
        "account_group_member",
        "playtime_goal",
        "notification_rule",
        "notification_delivery",
      ]),
    );
    expect(tableColumns("account_safety_policy")).toEqual(
      expect.arrayContaining([
        "hold_schedule_id",
        "hold_schedule_window",
        "hold_schedule_origin",
      ]),
    );
    expect(
      sqlite
        .prepare("SELECT account_name FROM steam_account WHERE id = ?")
        .get("historical-account"),
    ).toEqual({ account_name: "historical.runner" });
    expect(
      sqlite
        .prepare(
          "SELECT favorite, hidden, tags_json FROM steam_account_library WHERE account_id = ? AND app_id = ?",
        )
        .get("historical-account", 730),
    ).toEqual({ favorite: 0, hidden: 0, tags_json: "[]" });
  });

  it("migrates from the indexed schema and preserves existing indexes", () => {
    seedInitialSchema();
    seedOperationalIndexes();

    migrate();

    expect(getMigrationState().pending).toEqual([]);
    expect(indexNames()).toEqual(
      expect.arrayContaining([
        "admin_session_token_hash_idx",
        "steam_account_account_name_idx",
        "steam_event_created_at_idx",
        "boost_session_account_started_idx",
        "steam_account_library_app_idx",
        "steam_account_game_app_idx",
        "boost_preset_game_app_idx",
        "steam_app_cache_updated_at_idx",
      ]),
    );
  });

  it("fails legacy timed holds closed when schedule ownership is unavailable", () => {
    seedVersionNineTimedHolds();

    migrate();

    expect(
      sqlite
        .prepare(
          `SELECT account_id, hold_schedule_origin
           FROM account_safety_policy
           ORDER BY account_id`,
        )
        .all(),
    ).toEqual([
      { account_id: "legacy-manual", hold_schedule_origin: "unscheduled" },
      { account_id: "legacy-scheduled", hold_schedule_origin: "scheduled" },
      { account_id: "legacy-unknown", hold_schedule_origin: "unknown" },
    ]);
  });

  it("fails closed when the database contains a newer migration", () => {
    seedInitialSchema();
    sqlite
      .prepare(
        "INSERT INTO app_migration (id, description, applied_at) VALUES (?, ?, ?)",
      )
      .run(
        "999_future_schema",
        "Migration written by a newer SteamBee binary",
        baseTimestamp + 999,
      );

    expect(() => migrate()).toThrow(UnsupportedDatabaseSchemaError);
    expect(getMigrationState()).toMatchObject({
      current: "999_future_schema",
      latest: "010_timed_hold_ownership_provenance",
      unsupported: [
        {
          id: "999_future_schema",
          description: "Migration written by a newer SteamBee binary",
        },
      ],
    });
    expect(checkDatabaseReady()).toMatchObject({ ok: false });
    expect(tableNames()).not.toContain("boost_preset");
  });

  it("clears active preset references when a preset is deleted", () => {
    seedInitialSchema();
    seedHistoricalAccount();
    migrate();
    sqlite.exec(`
      INSERT INTO boost_preset (
        id, account_id, name, persona_state, created_at, updated_at
      ) VALUES ('preset-trigger', 'historical-account', 'Trigger preset', 7, ${baseTimestamp}, ${baseTimestamp});
      UPDATE steam_account
      SET active_preset_id = 'preset-trigger'
      WHERE id = 'historical-account';
      DELETE FROM boost_preset WHERE id = 'preset-trigger';
    `);

    expect(
      sqlite
        .prepare("SELECT active_preset_id FROM steam_account WHERE id = ?")
        .get("historical-account"),
    ).toEqual({ active_preset_id: null });
  });

  it("uses app-centric indexes for admin read-model aggregation", () => {
    seedInitialSchema();
    migrate();

    expect(
      queryPlan(
        "SELECT app_id, count(*) FROM steam_account_library GROUP BY app_id",
      ),
    ).toContain("steam_account_library_app_idx");
    expect(
      queryPlan(
        "SELECT app_id, count(*) FROM steam_account_game GROUP BY app_id",
      ),
    ).toContain("steam_account_game_app_idx");
    expect(
      queryPlan(
        "SELECT app_id, count(*) FROM boost_preset_game GROUP BY app_id",
      ),
    ).toContain("boost_preset_game_app_idx");
    expect(
      queryPlan(
        "SELECT app_id FROM steam_app_cache ORDER BY updated_at DESC LIMIT 200",
      ),
    ).toContain("steam_app_cache_updated_at_idx");
  });
});

function queryPlan(sql: string) {
  return sqlite
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all()
    .map((row) => String((row as { detail: string }).detail))
    .join("\n");
}

function resetDatabase() {
  sqlite.pragma("foreign_keys = OFF");
  for (const table of tableNames()) {
    sqlite.exec(`DROP TABLE IF EXISTS "${table}"`);
  }
  sqlite.pragma("foreign_keys = ON");
}

function seedInitialSchema() {
  sqlite.exec(`
    CREATE TABLE app_migration (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );

    INSERT INTO app_migration (id, description, applied_at)
    VALUES ('001_initial_schema', 'Initial SteamBee schema', ${baseTimestamp});

    CREATE TABLE admin_user (
      id TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE admin_session (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      csrf_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );

    CREATE TABLE steam_account (
      id TEXT PRIMARY KEY,
      account_name TEXT NOT NULL UNIQUE,
      steam_id TEXT,
      status TEXT NOT NULL DEFAULT 'disconnected',
      desired_state TEXT NOT NULL DEFAULT 'stopped',
      persona_state INTEGER NOT NULL DEFAULT 7,
      custom_title TEXT,
      token_ciphertext TEXT,
      token_iv TEXT,
      token_auth_tag TEXT,
      token_expires_at INTEGER,
      token_key_version INTEGER NOT NULL DEFAULT 1,
      last_error TEXT,
      latest_boost_started_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE steam_account_game (
      account_id TEXT NOT NULL REFERENCES steam_account(id) ON DELETE CASCADE,
      app_id INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at INTEGER NOT NULL,
      UNIQUE(account_id, app_id)
    );

    CREATE TABLE steam_app_cache (
      app_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      playtime_forever INTEGER DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'manual',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE steam_account_library (
      account_id TEXT NOT NULL REFERENCES steam_account(id) ON DELETE CASCADE,
      app_id INTEGER NOT NULL REFERENCES steam_app_cache(app_id) ON DELETE CASCADE,
      playtime_forever INTEGER DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'library',
      imported_at INTEGER NOT NULL,
      UNIQUE(account_id, app_id)
    );

    CREATE TABLE steam_event (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT REFERENCES steam_account(id) ON DELETE CASCADE,
      level TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata_json TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
  `);
}

function seedOperationalIndexes() {
  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS admin_session_token_hash_idx
      ON admin_session(token_hash);
    CREATE UNIQUE INDEX IF NOT EXISTS steam_account_account_name_idx
      ON steam_account(account_name);
    CREATE UNIQUE INDEX IF NOT EXISTS steam_account_game_account_app_idx
      ON steam_account_game(account_id, app_id);
    CREATE UNIQUE INDEX IF NOT EXISTS steam_account_library_account_app_idx
      ON steam_account_library(account_id, app_id);
    CREATE INDEX IF NOT EXISTS steam_event_created_at_idx
      ON steam_event(created_at DESC);
    CREATE INDEX IF NOT EXISTS steam_event_account_created_at_idx
      ON steam_event(account_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS steam_event_type_created_at_idx
      ON steam_event(type, created_at DESC);

    INSERT INTO app_migration (id, description, applied_at)
    VALUES (
      '002_operational_indexes',
      'Operational indexes for sessions, accounts, events and library',
      ${baseTimestamp + 1}
    );
  `);
}

function seedVersionNineTimedHolds() {
  seedInitialSchema();
  sqlite.exec(`
    CREATE TABLE account_safety_policy (
      account_id TEXT PRIMARY KEY REFERENCES steam_account(id) ON DELETE CASCADE,
      resume_policy TEXT NOT NULL DEFAULT 'automatic',
      resume_delay_minutes INTEGER NOT NULL DEFAULT 15,
      max_session_minutes INTEGER,
      max_daily_minutes INTEGER,
      max_weekly_minutes INTEGER,
      pause_until INTEGER,
      hold_reason TEXT,
      hold_created_at INTEGER,
      hold_schedule_id TEXT,
      hold_schedule_window TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    INSERT INTO steam_account (
      id, account_name, status, desired_state, persona_state,
      token_key_version, created_at, updated_at
    ) VALUES
      ('legacy-manual', 'legacy.manual', 'paused_manual', 'paused', 7, 1, ${baseTimestamp}, ${baseTimestamp}),
      ('legacy-scheduled', 'legacy.scheduled', 'paused_other_session', 'running', 7, 1, ${baseTimestamp}, ${baseTimestamp}),
      ('legacy-unknown', 'legacy.unknown', 'paused_manual', 'paused', 7, 1, ${baseTimestamp}, ${baseTimestamp});

    INSERT INTO account_safety_policy (
      account_id, pause_until, hold_reason, hold_created_at,
      hold_schedule_id, hold_schedule_window, created_at, updated_at
    ) VALUES
      ('legacy-manual', NULL, 'manual', ${baseTimestamp}, NULL, NULL, ${baseTimestamp}, ${baseTimestamp}),
      ('legacy-scheduled', ${baseTimestamp + 60_000}, 'other_session_delay', ${baseTimestamp}, 'schedule-a', 'window-a', ${baseTimestamp}, ${baseTimestamp}),
      ('legacy-unknown', ${baseTimestamp + 60_000}, 'pause_until', ${baseTimestamp}, NULL, NULL, ${baseTimestamp}, ${baseTimestamp});
  `);

  const insertMigration = sqlite.prepare(
    "INSERT INTO app_migration (id, description, applied_at) VALUES (?, ?, ?)",
  );
  for (const [index, id] of [
    "002_operational_indexes",
    "003_presets_schedules_analytics",
    "004_single_admin_and_preset_integrity",
    "005_app_read_model_indexes",
    "006_operational_safety_foundation",
    "007_schedule_exceptions_groups_goals",
    "008_notifications",
    "009_timed_hold_schedule_ownership",
  ].entries()) {
    insertMigration.run(id, "test fixture", baseTimestamp + index + 1);
  }
}

function seedHistoricalAccount() {
  sqlite
    .prepare(
      `
      INSERT INTO steam_account (
        id,
        account_name,
        steam_id,
        status,
        desired_state,
        persona_state,
        token_key_version,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    )
    .run(
      "historical-account",
      "historical.runner",
      "76561198000000123",
      "disconnected",
      "stopped",
      7,
      1,
      baseTimestamp,
      baseTimestamp,
    );

  sqlite
    .prepare(
      `
      INSERT INTO steam_app_cache (app_id, name, playtime_forever, source, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `,
    )
    .run(730, "Counter-Strike 2", 42, "library", baseTimestamp);

  sqlite
    .prepare(
      `
      INSERT INTO steam_account_library (
        account_id,
        app_id,
        playtime_forever,
        source,
        imported_at
      )
      VALUES (?, ?, ?, ?, ?)
    `,
    )
    .run("historical-account", 730, 42, "library", baseTimestamp);
}

function tableNames() {
  return sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => String((row as { name: string }).name));
}

function tableColumns(table: string) {
  return sqlite
    .prepare(`PRAGMA table_info("${table}")`)
    .all()
    .map((row) => String((row as { name: string }).name));
}

function indexNames() {
  return sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name",
    )
    .all()
    .map((row) => String((row as { name: string }).name));
}
