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

export class UnsupportedDatabaseSchemaError extends Error {
  constructor(readonly migrationIds: string[]) {
    super(
      `Database contains migrations unsupported by this SteamBee version: ${migrationIds.join(", ")}. Refusing to start an older binary against a newer schema.`,
    );
    this.name = "UnsupportedDatabaseSchemaError";
  }
}

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
  {
    id: "006_operational_safety_foundation",
    description: "Account recovery health and safety policies",
    sql: `
      CREATE TABLE IF NOT EXISTS account_health_state (
        account_id TEXT PRIMARY KEY REFERENCES steam_account(id) ON DELETE CASCADE,
        last_steam_contact_at INTEGER,
        next_retry_at INTEGER,
        retry_attempt INTEGER NOT NULL DEFAULT 0,
        error_class TEXT NOT NULL DEFAULT 'none',
        error_code INTEGER,
        recovery_action TEXT NOT NULL DEFAULT 'none',
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS account_safety_policy (
        account_id TEXT PRIMARY KEY REFERENCES steam_account(id) ON DELETE CASCADE,
        resume_policy TEXT NOT NULL DEFAULT 'automatic',
        resume_delay_minutes INTEGER NOT NULL DEFAULT 15,
        max_session_minutes INTEGER,
        max_daily_minutes INTEGER,
        max_weekly_minutes INTEGER,
        pause_until INTEGER,
        hold_reason TEXT,
        hold_created_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT OR IGNORE INTO account_health_state (account_id, updated_at)
      SELECT id, CAST(unixepoch('subsec') * 1000 AS INTEGER) FROM steam_account;
      INSERT OR IGNORE INTO account_safety_policy (account_id, created_at, updated_at)
      SELECT id,
             CAST(unixepoch('subsec') * 1000 AS INTEGER),
             CAST(unixepoch('subsec') * 1000 AS INTEGER)
      FROM steam_account;
    `,
  },
  {
    id: "007_schedule_exceptions_groups_goals",
    description: "Schedule exceptions, safe account groups and read-only goals",
    sql: `
      CREATE TABLE IF NOT EXISTS schedule_exception (
        id TEXT PRIMARY KEY,
        schedule_id TEXT NOT NULL REFERENCES boost_schedule(id) ON DELETE CASCADE,
        account_id TEXT NOT NULL REFERENCES steam_account(id) ON DELETE CASCADE,
        window_id TEXT NOT NULL,
        action TEXT NOT NULL DEFAULT 'skip',
        created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS schedule_exception_window_idx
        ON schedule_exception(schedule_id, window_id, action);
      CREATE INDEX IF NOT EXISTS schedule_exception_account_idx
        ON schedule_exception(account_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS account_group (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS account_group_member (
        group_id TEXT NOT NULL REFERENCES account_group(id) ON DELETE CASCADE,
        account_id TEXT NOT NULL REFERENCES steam_account(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        UNIQUE(group_id, account_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS account_group_member_idx
        ON account_group_member(group_id, account_id);
      CREATE INDEX IF NOT EXISTS account_group_member_account_idx
        ON account_group_member(account_id);

      CREATE TABLE IF NOT EXISTS playtime_goal (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES steam_account(id) ON DELETE CASCADE,
        app_id INTEGER NOT NULL,
        target_minutes INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(account_id, app_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS playtime_goal_account_app_idx
        ON playtime_goal(account_id, app_id);
    `,
  },
  {
    id: "008_notifications",
    description: "Browser and durable webhook notification rules",
    sql: `
      CREATE TABLE IF NOT EXISTS notification_rule (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        target TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        event_types_json TEXT NOT NULL,
        webhook_ciphertext TEXT,
        webhook_iv TEXT,
        webhook_auth_tag TEXT,
        webhook_key_version INTEGER NOT NULL DEFAULT 1,
        failure_count INTEGER NOT NULL DEFAULT 0,
        disabled_until INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notification_delivery (
        id TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL REFERENCES notification_rule(id) ON DELETE CASCADE,
        event_id INTEGER NOT NULL REFERENCES steam_event(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(rule_id, event_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS notification_delivery_rule_event_idx
        ON notification_delivery(rule_id, event_id);
      CREATE INDEX IF NOT EXISTS notification_delivery_pending_idx
        ON notification_delivery(status, next_attempt_at);
    `,
  },
  {
    id: "009_timed_hold_schedule_ownership",
    description: "Persist schedule ownership for timed safety holds",
    sql: `
      ALTER TABLE account_safety_policy ADD COLUMN hold_schedule_id TEXT;
      ALTER TABLE account_safety_policy ADD COLUMN hold_schedule_window TEXT;

      UPDATE account_safety_policy
      SET hold_schedule_id = (
            SELECT schedule.id
            FROM boost_schedule AS schedule
            WHERE schedule.account_id = account_safety_policy.account_id
              AND schedule.last_started_window IS NOT NULL
              AND (
                schedule.last_stopped_window IS NULL OR
                schedule.last_stopped_window != schedule.last_started_window
              )
            ORDER BY schedule.updated_at DESC, schedule.id DESC
            LIMIT 1
          ),
          hold_schedule_window = (
            SELECT schedule.last_started_window
            FROM boost_schedule AS schedule
            WHERE schedule.account_id = account_safety_policy.account_id
              AND schedule.last_started_window IS NOT NULL
              AND (
                schedule.last_stopped_window IS NULL OR
                schedule.last_stopped_window != schedule.last_started_window
              )
            ORDER BY schedule.updated_at DESC, schedule.id DESC
            LIMIT 1
          )
      WHERE hold_reason IN ('pause_until', 'other_session_delay');
    `,
  },
  {
    id: "010_timed_hold_ownership_provenance",
    description: "Distinguish unscheduled, scheduled and unknown hold owners",
    sql: `
      ALTER TABLE account_safety_policy
        ADD COLUMN hold_schedule_origin TEXT NOT NULL DEFAULT 'unscheduled';

      UPDATE account_safety_policy
      SET hold_schedule_origin = CASE
        WHEN hold_schedule_id IS NOT NULL AND hold_schedule_window IS NOT NULL
          THEN 'scheduled'
        ELSE 'unknown'
      END
      WHERE hold_reason IN ('pause_until', 'other_session_delay');
    `,
  },
  {
    id: "011_automatic_session_recovery",
    description:
      "Isolate notification revisions and normalize automatic recovery",
    sql: `
      ALTER TABLE notification_rule
        ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE notification_rule
        ADD COLUMN start_after_event_id INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE notification_delivery
        ADD COLUMN rule_revision INTEGER NOT NULL DEFAULT 1;

      UPDATE notification_rule
      SET start_after_event_id = COALESCE((
        SELECT MAX(event.id)
        FROM steam_event AS event
        WHERE event.created_at < notification_rule.created_at
      ), 0);

      UPDATE notification_delivery
      SET rule_revision = COALESCE((
        SELECT rule.revision
        FROM notification_rule AS rule
        WHERE rule.id = notification_delivery.rule_id
      ), 1);

      DELETE FROM notification_delivery
      WHERE rule_id IN (
        SELECT rule.id
        FROM notification_rule AS rule, json_each(rule.event_types_json)
        WHERE rule.target = 'browser'
          AND json_each.value = 'steam.status.paused_other_session'
      );

      UPDATE notification_rule
      SET event_types_json = (
            SELECT json_group_array(selector)
            FROM (
              SELECT
                CASE
                  WHEN json_each.value = 'steam.status.paused_other_session'
                    THEN 'steam.session.conflict'
                  ELSE json_each.value
                END AS selector,
                MIN(CAST(json_each.key AS INTEGER)) AS first_position
              FROM json_each(notification_rule.event_types_json)
              GROUP BY selector
              ORDER BY first_position
            )
          ),
          revision = revision + 1,
          start_after_event_id = COALESCE((SELECT MAX(id) FROM steam_event), 0),
          updated_at = MAX(
            updated_at,
            CAST(strftime('%s', 'now') AS INTEGER) * 1000
          )
      WHERE target = 'browser'
        AND EXISTS (
          SELECT 1
          FROM json_each(notification_rule.event_types_json)
          WHERE json_each.value = 'steam.status.paused_other_session'
        );

      UPDATE steam_account
      SET desired_state = 'running',
          status = 'disconnected',
          last_error = NULL
      WHERE id IN (
        SELECT account_id
        FROM account_safety_policy
        WHERE hold_reason IN ('other_session_delay', 'other_session_manual')
      );

      UPDATE account_health_state
      SET next_retry_at = NULL,
          retry_attempt = 0,
          error_class = 'none',
          error_code = NULL,
          recovery_action = 'none'
      WHERE account_id IN (
        SELECT account_id
        FROM account_safety_policy
        WHERE hold_reason IN ('other_session_delay', 'other_session_manual')
      );

      UPDATE account_safety_policy
      SET resume_policy = 'automatic',
          resume_delay_minutes = 15,
          pause_until = CASE
            WHEN hold_reason IN ('other_session_delay', 'other_session_manual')
              THEN NULL
            ELSE pause_until
          END,
          hold_reason = CASE
            WHEN hold_reason IN ('other_session_delay', 'other_session_manual')
              THEN NULL
            ELSE hold_reason
          END,
          hold_created_at = CASE
            WHEN hold_reason IN ('other_session_delay', 'other_session_manual')
              THEN NULL
            ELSE hold_created_at
          END,
          hold_schedule_id = CASE
            WHEN hold_reason IN ('other_session_delay', 'other_session_manual')
              THEN NULL
            ELSE hold_schedule_id
          END,
          hold_schedule_window = CASE
            WHEN hold_reason IN ('other_session_delay', 'other_session_manual')
              THEN NULL
            ELSE hold_schedule_window
          END,
          hold_schedule_origin = CASE
            WHEN hold_reason IN ('other_session_delay', 'other_session_manual')
              THEN 'unscheduled'
            ELSE hold_schedule_origin
          END;
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
  assertSupportedMigrations(applied);

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
  const knownIds = new Set(migrations.map((migration) => migration.id));
  const applied = (
    sqlite
      .prepare(
        "SELECT id, description, applied_at as appliedAt FROM app_migration ORDER BY applied_at ASC",
      )
      .all() as Array<{ id: string; description: string; appliedAt: number }>
  ).sort((left, right) => {
    const leftIndex = migrations.findIndex(
      (migration) => migration.id === left.id,
    );
    const rightIndex = migrations.findIndex(
      (migration) => migration.id === right.id,
    );
    const leftOrder = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const rightOrder = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.appliedAt - right.appliedAt;
  });
  const appliedIds = new Set(applied.map((migration) => migration.id));
  const unsupported = applied
    .filter((migration) => !knownIds.has(migration.id))
    .map(({ id, description }) => ({ id, description }));
  return {
    current: applied.at(-1)?.id ?? null,
    latest: migrations.at(-1)?.id ?? null,
    applied,
    unsupported,
    pending: migrations
      .filter((migration) => !appliedIds.has(migration.id))
      .map(({ id, description }) => ({ id, description })),
  };
}

export function checkDatabaseReady() {
  sqlite.prepare("SELECT 1").get();
  const migrationState = getMigrationState();
  return {
    ok:
      migrationState.pending.length === 0 &&
      migrationState.unsupported.length === 0,
    migrationState,
  };
}

function assertSupportedMigrations(appliedIds: Iterable<string>) {
  const knownIds = new Set(migrations.map((migration) => migration.id));
  const unsupported = [...appliedIds].filter((id) => !knownIds.has(id));
  if (unsupported.length > 0) {
    throw new UnsupportedDatabaseSchemaError(unsupported.sort());
  }
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
