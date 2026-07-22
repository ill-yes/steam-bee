import { sql } from "drizzle-orm";
import {
  index,
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
    appIdx: index("steam_account_game_app_idx").on(table.appId),
  }),
);

export const steamAppCache = sqliteTable(
  "steam_app_cache",
  {
    appId: integer("app_id").primaryKey(),
    name: text("name").notNull(),
    playtimeForever: integer("playtime_forever").default(0),
    source: text("source").notNull().default("manual"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    updatedAtIdx: index("steam_app_cache_updated_at_idx").on(table.updatedAt),
  }),
);

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
    appIdx: index("steam_account_library_app_idx").on(table.appId),
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
    appIdx: index("boost_preset_game_app_idx").on(table.appId),
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

export const accountHealthState = sqliteTable("account_health_state", {
  accountId: text("account_id")
    .primaryKey()
    .references(() => steamAccount.id, { onDelete: "cascade" }),
  lastSteamContactAt: integer("last_steam_contact_at"),
  nextRetryAt: integer("next_retry_at"),
  retryAttempt: integer("retry_attempt").notNull().default(0),
  errorClass: text("error_class").notNull().default("none"),
  errorCode: integer("error_code"),
  recoveryAction: text("recovery_action").notNull().default("none"),
  updatedAt: integer("updated_at").notNull(),
});

export const accountSafetyPolicy = sqliteTable("account_safety_policy", {
  accountId: text("account_id")
    .primaryKey()
    .references(() => steamAccount.id, { onDelete: "cascade" }),
  resumePolicy: text("resume_policy").notNull().default("automatic"),
  resumeDelayMinutes: integer("resume_delay_minutes").notNull().default(15),
  maxSessionMinutes: integer("max_session_minutes"),
  maxDailyMinutes: integer("max_daily_minutes"),
  maxWeeklyMinutes: integer("max_weekly_minutes"),
  pauseUntil: integer("pause_until"),
  holdReason: text("hold_reason"),
  holdCreatedAt: integer("hold_created_at"),
  holdScheduleId: text("hold_schedule_id"),
  holdScheduleWindow: text("hold_schedule_window"),
  holdScheduleOrigin: text("hold_schedule_origin")
    .notNull()
    .default("unscheduled"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const scheduleException = sqliteTable(
  "schedule_exception",
  {
    id: text("id").primaryKey(),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => boostSchedule.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => steamAccount.id, { onDelete: "cascade" }),
    windowId: text("window_id").notNull(),
    action: text("action").notNull().default("skip"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    scheduleWindowIdx: uniqueIndex("schedule_exception_window_idx").on(
      table.scheduleId,
      table.windowId,
      table.action,
    ),
  }),
);

export const accountGroup = sqliteTable("account_group", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const accountGroupMember = sqliteTable(
  "account_group_member",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => accountGroup.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => steamAccount.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    groupAccountIdx: uniqueIndex("account_group_member_idx").on(
      table.groupId,
      table.accountId,
    ),
  }),
);

export const playtimeGoal = sqliteTable(
  "playtime_goal",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => steamAccount.id, { onDelete: "cascade" }),
    appId: integer("app_id").notNull(),
    targetMinutes: integer("target_minutes").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    accountAppIdx: uniqueIndex("playtime_goal_account_app_idx").on(
      table.accountId,
      table.appId,
    ),
  }),
);

export const notificationRule = sqliteTable("notification_rule", {
  id: text("id").primaryKey(),
  revision: integer("revision").notNull().default(1),
  startAfterEventId: integer("start_after_event_id").notNull().default(0),
  name: text("name").notNull(),
  target: text("target").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  eventTypesJson: text("event_types_json").notNull(),
  webhookCiphertext: text("webhook_ciphertext"),
  webhookIv: text("webhook_iv"),
  webhookAuthTag: text("webhook_auth_tag"),
  webhookKeyVersion: integer("webhook_key_version").notNull().default(1),
  failureCount: integer("failure_count").notNull().default(0),
  disabledUntil: integer("disabled_until"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const notificationDelivery = sqliteTable(
  "notification_delivery",
  {
    id: text("id").primaryKey(),
    ruleId: text("rule_id")
      .notNull()
      .references(() => notificationRule.id, { onDelete: "cascade" }),
    ruleRevision: integer("rule_revision").notNull().default(1),
    eventId: integer("event_id")
      .notNull()
      .references(() => steamEvent.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at"),
    lastError: text("last_error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    ruleEventIdx: uniqueIndex("notification_delivery_rule_event_idx").on(
      table.ruleId,
      table.eventId,
    ),
    pendingIdx: index("notification_delivery_pending_idx").on(
      table.status,
      table.nextAttemptAt,
    ),
  }),
);
