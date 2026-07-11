import { chmodSync } from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { paths } from "../config.js";
import * as schema from "./schema.js";

export const sqlite = new Database(paths.database);
secureDatabaseFiles();
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");
sqlite.pragma("synchronous = NORMAL");
secureDatabaseFiles();

export const db = drizzle(sqlite, { schema });

type Migration = {
  id: string;
  description: string;
  sql: string;
};

const migrations: Migration[] = [
  {
    id: "001_initial_schema",
    description: "Initial SteamBee schema",
    sql: `
      CREATE TABLE IF NOT EXISTS admin_user (
        id TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS admin_session (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        csrf_token TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS steam_account (
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

      CREATE TABLE IF NOT EXISTS steam_account_game (
        account_id TEXT NOT NULL REFERENCES steam_account(id) ON DELETE CASCADE,
        app_id INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at INTEGER NOT NULL,
        UNIQUE(account_id, app_id)
      );

      CREATE TABLE IF NOT EXISTS steam_app_cache (
        app_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        playtime_forever INTEGER DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'manual',
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS steam_account_library (
        account_id TEXT NOT NULL REFERENCES steam_account(id) ON DELETE CASCADE,
        app_id INTEGER NOT NULL REFERENCES steam_app_cache(app_id) ON DELETE CASCADE,
        playtime_forever INTEGER DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'library',
        imported_at INTEGER NOT NULL,
        UNIQUE(account_id, app_id)
      );

      CREATE TABLE IF NOT EXISTS steam_event (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT REFERENCES steam_account(id) ON DELETE CASCADE,
        level TEXT NOT NULL,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata_json TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL
      );
    `,
  },
  {
    id: "002_operational_indexes",
    description:
      "Operational indexes for sessions, accounts, events and library",
    sql: `
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
    `,
  },
  {
    id: "003_presets_schedules_analytics",
    description:
      "Boost presets, schedules, library metadata and analytics sessions",
    sql: `
      ALTER TABLE steam_account ADD COLUMN active_preset_id TEXT;
      ALTER TABLE steam_account_library ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE steam_account_library ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE steam_account_library ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';

      CREATE TABLE IF NOT EXISTS boost_preset (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES steam_account(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        persona_state INTEGER NOT NULL DEFAULT 7,
        custom_title TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS boost_preset_game (
        preset_id TEXT NOT NULL REFERENCES boost_preset(id) ON DELETE CASCADE,
        app_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(preset_id, app_id)
      );

      CREATE TABLE IF NOT EXISTS boost_schedule (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES steam_account(id) ON DELETE CASCADE,
        preset_id TEXT NOT NULL REFERENCES boost_preset(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        weekdays_json TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        timezone TEXT NOT NULL,
        last_started_window TEXT,
        last_stopped_window TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS boost_session (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES steam_account(id) ON DELETE CASCADE,
        preset_id TEXT REFERENCES boost_preset(id) ON DELETE SET NULL,
        app_ids_json TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        stop_reason TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS boost_preset_game_preset_app_idx
        ON boost_preset_game(preset_id, app_id);
      CREATE INDEX IF NOT EXISTS boost_preset_account_idx
        ON boost_preset(account_id);
      CREATE INDEX IF NOT EXISTS boost_schedule_account_idx
        ON boost_schedule(account_id);
      CREATE INDEX IF NOT EXISTS boost_schedule_enabled_idx
        ON boost_schedule(enabled);
      CREATE INDEX IF NOT EXISTS boost_session_account_started_idx
        ON boost_session(account_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS boost_session_open_idx
        ON boost_session(account_id, ended_at);
    `,
  },
  {
    id: "004_single_admin_and_preset_integrity",
    description: "Single-admin and active preset integrity constraints",
    sql: `
      DELETE FROM admin_user
      WHERE id NOT IN (
        SELECT id FROM admin_user
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      );

      ALTER TABLE admin_user
        ADD COLUMN singleton_key INTEGER NOT NULL DEFAULT 1 CHECK (singleton_key = 1);

      CREATE UNIQUE INDEX IF NOT EXISTS admin_user_singleton_idx
        ON admin_user(singleton_key);

      CREATE TRIGGER IF NOT EXISTS boost_preset_clear_active_after_delete
      AFTER DELETE ON boost_preset
      BEGIN
        UPDATE steam_account
        SET active_preset_id = NULL,
            updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER)
        WHERE active_preset_id = OLD.id;
      END;
    `,
  },
  {
    id: "005_app_read_model_indexes",
    description: "App-centric indexes for admin read models and cache cleanup",
    sql: `
      CREATE INDEX IF NOT EXISTS steam_account_library_app_idx
        ON steam_account_library(app_id);
      CREATE INDEX IF NOT EXISTS steam_account_game_app_idx
        ON steam_account_game(app_id);
      CREATE INDEX IF NOT EXISTS boost_preset_game_app_idx
        ON boost_preset_game(app_id);
      CREATE INDEX IF NOT EXISTS steam_app_cache_updated_at_idx
        ON steam_app_cache(updated_at);
    `,
  },
];

export function migrate() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS app_migration (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const applied = new Set(
    sqlite
      .prepare("SELECT id FROM app_migration")
      .all()
      .map((row) => String((row as { id: string }).id)),
  );

  const insertMigration = sqlite.prepare(`
    INSERT INTO app_migration (id, description, applied_at)
    VALUES (?, ?, ?)
  `);

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    const apply = sqlite.transaction(() => {
      sqlite.exec(migration.sql);
      insertMigration.run(migration.id, migration.description, Date.now());
    });
    apply();
  }
}

export function getMigrationState() {
  const applied = sqlite
    .prepare(
      "SELECT id, description, applied_at as appliedAt FROM app_migration ORDER BY applied_at ASC",
    )
    .all() as Array<{ id: string; description: string; appliedAt: number }>;
  const appliedIds = new Set(applied.map((migration) => migration.id));
  return {
    current: applied.at(-1)?.id ?? null,
    latest: migrations.at(-1)?.id ?? null,
    applied,
    pending: migrations
      .filter((migration) => !appliedIds.has(migration.id))
      .map(({ id, description }) => ({ id, description })),
  };
}

export function checkDatabaseReady() {
  sqlite.prepare("SELECT 1").get();
  const migrationState = getMigrationState();
  return {
    ok: migrationState.pending.length === 0,
    migrationState,
  };
}

function secureDatabaseFiles() {
  if (process.platform === "win32") return;

  for (const path of [
    paths.database,
    `${paths.database}-wal`,
    `${paths.database}-shm`,
    `${paths.database}-journal`,
  ]) {
    try {
      chmodSync(path, 0o600);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
