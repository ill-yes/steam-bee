import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const appMigration = sqliteTable("app_migration", {
  id: text("id").primaryKey(),
  description: text("description").notNull(),
  appliedAt: integer("applied_at").notNull(),
});

export const adminUser = sqliteTable("admin_user", {
  id: text("id").primaryKey(),
  singletonKey: integer("singleton_key").notNull().default(1),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const adminSession = sqliteTable(
  "admin_session",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    csrfToken: text("csrf_token").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (table) => ({
    tokenHashIdx: uniqueIndex("admin_session_token_hash_idx").on(
      table.tokenHash,
    ),
  }),
);

export const steamAccount = sqliteTable(
  "steam_account",
  {
    id: text("id").primaryKey(),
    accountName: text("account_name").notNull(),
    steamId: text("steam_id"),
    status: text("status").notNull().default("disconnected"),
    desiredState: text("desired_state").notNull().default("stopped"),
    personaState: integer("persona_state").notNull().default(7),
    customTitle: text("custom_title"),
    activePresetId: text("active_preset_id"),
    tokenCiphertext: text("token_ciphertext"),
    tokenIv: text("token_iv"),
    tokenAuthTag: text("token_auth_tag"),
    tokenExpiresAt: integer("token_expires_at"),
    tokenKeyVersion: integer("token_key_version").notNull().default(1),
    lastError: text("last_error"),
    latestBoostStartedAt: integer("latest_boost_started_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    accountNameIdx: uniqueIndex("steam_account_account_name_idx").on(
      table.accountName,
    ),
  }),
);

export const steamAccountGame = sqliteTable(
  "steam_account_game",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => steamAccount.id, { onDelete: "cascade" }),
    appId: integer("app_id").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    source: text("source").notNull().default("manual"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    accountAppIdx: uniqueIndex("steam_account_game_account_app_idx").on(
      table.accountId,
      table.appId,
    ),
  }),
);

export const steamAppCache = sqliteTable("steam_app_cache", {
  appId: integer("app_id").primaryKey(),
  name: text("name").notNull(),
  playtimeForever: integer("playtime_forever").default(0),
  source: text("source").notNull().default("manual"),
  updatedAt: integer("updated_at").notNull(),
});

export const steamAccountLibrary = sqliteTable(
  "steam_account_library",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => steamAccount.id, { onDelete: "cascade" }),
    appId: integer("app_id")
      .notNull()
      .references(() => steamAppCache.appId, { onDelete: "cascade" }),
    playtimeForever: integer("playtime_forever").default(0),
    source: text("source").notNull().default("library"),
    favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    tagsJson: text("tags_json").notNull().default("[]"),
    importedAt: integer("imported_at").notNull(),
  },
  (table) => ({
    accountAppIdx: uniqueIndex("steam_account_library_account_app_idx").on(
      table.accountId,
      table.appId,
    ),
  }),
);

export const boostPreset = sqliteTable("boost_preset", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => steamAccount.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  personaState: integer("persona_state").notNull().default(7),
  customTitle: text("custom_title"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const boostPresetGame = sqliteTable(
  "boost_preset_game",
  {
    presetId: text("preset_id")
      .notNull()
      .references(() => boostPreset.id, { onDelete: "cascade" }),
    appId: integer("app_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    presetAppIdx: uniqueIndex("boost_preset_game_preset_app_idx").on(
      table.presetId,
      table.appId,
    ),
  }),
);

export const boostSchedule = sqliteTable("boost_schedule", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => steamAccount.id, { onDelete: "cascade" }),
  presetId: text("preset_id")
    .notNull()
    .references(() => boostPreset.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  weekdaysJson: text("weekdays_json").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  timezone: text("timezone").notNull(),
  lastStartedWindow: text("last_started_window"),
  lastStoppedWindow: text("last_stopped_window"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const boostSession = sqliteTable("boost_session", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => steamAccount.id, { onDelete: "cascade" }),
  presetId: text("preset_id").references(() => boostPreset.id, {
    onDelete: "set null",
  }),
  appIdsJson: text("app_ids_json").notNull(),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at"),
  stopReason: text("stop_reason"),
  createdAt: integer("created_at").notNull(),
});

export const steamEvent = sqliteTable("steam_event", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: text("account_id").references(() => steamAccount.id, {
    onDelete: "cascade",
  }),
  level: text("level").notNull(),
  type: text("type").notNull(),
  message: text("message").notNull(),
  metadataJson: text("metadata_json").default(sql`'{}'`),
  createdAt: integer("created_at").notNull(),
});
