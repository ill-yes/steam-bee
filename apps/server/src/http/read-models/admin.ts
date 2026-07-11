import {
  isPersonaState,
  type AdminAccountSummary,
  type AdminOverview,
} from "@steam-bee/contracts";
import { desc } from "drizzle-orm";
import { listAdminSessions } from "../../auth/service.js";
import { db, sqlite } from "../../db/client.js";
import { steamAccount, steamEvent } from "../../db/schema.js";
import { steamManager } from "../../steam/manager.js";
import { parseIntegerArray } from "../../util/json.js";
import { presentSteamEvent } from "../events.js";
import { presentSteamAccount } from "../presenters.js";

type AdminPresetSummary = AdminOverview["presets"][number];
type AdminScheduleSummary = AdminOverview["schedules"][number];
type AdminAppSummary = AdminOverview["apps"][number];
type AdminTotals = AdminOverview["totals"];
type AccountCounts = Pick<
  AdminAccountSummary,
  | "selectedGameCount"
  | "libraryAppCount"
  | "presetCount"
  | "scheduleCount"
  | "eventCount"
>;

const emptyAccountCounts: AccountCounts = {
  selectedGameCount: 0,
  libraryAppCount: 0,
  presetCount: 0,
  scheduleCount: 0,
  eventCount: 0,
};

export async function getAdminOverview(
  currentSessionId: string,
): Promise<AdminOverview> {
  const [accounts, events, sessions] = await Promise.all([
    db.select().from(steamAccount).orderBy(desc(steamAccount.updatedAt)),
    db.select().from(steamEvent).orderBy(desc(steamEvent.createdAt)).limit(100),
    listAdminSessions(currentSessionId),
  ]);
  const accountCounts = readAccountCounts();

  return {
    generatedAt: Date.now(),
    totals: readAdminTotals(accounts.length, sessions.length),
    sessions,
    accounts: accounts.map(
      (account) =>
        ({
          ...presentSteamAccount(account, steamManager.getStatus(account.id)),
          ...(accountCounts.get(account.id) ?? emptyAccountCounts),
        }) satisfies AdminAccountSummary,
    ),
    events: events.map(presentSteamEvent),
    presets: readAdminPresets(),
    schedules: readAdminSchedules(),
    apps: readAdminAppCache(),
  };
}

export function listUnusedAppCacheIds() {
  return sqlite
    .prepare(
      `
      SELECT app.app_id as appId
      FROM steam_app_cache app
      WHERE NOT EXISTS (
        SELECT 1 FROM steam_account_library library WHERE library.app_id = app.app_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM steam_account_game selected WHERE selected.app_id = app.app_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM boost_preset_game preset_game WHERE preset_game.app_id = app.app_id
      )
      `,
    )
    .all()
    .map((row) => Number((row as { appId: number }).appId));
}

function readAdminTotals(accounts: number, sessions: number): AdminTotals {
  const row = sqlite
    .prepare(
      `
      SELECT
        (SELECT count(*) FROM steam_event) AS events,
        (SELECT count(*) FROM boost_preset) AS presets,
        (SELECT count(*) FROM boost_schedule) AS schedules,
        (SELECT count(*) FROM steam_app_cache) AS appCache,
        (SELECT count(*) FROM steam_account_library) AS libraryEntries,
        (SELECT count(*) FROM steam_account_game) AS selectedGames
      `,
    )
    .get() as Omit<AdminTotals, "accounts" | "sessions">;

  return {
    accounts,
    sessions,
    events: Number(row.events),
    presets: Number(row.presets),
    schedules: Number(row.schedules),
    appCache: Number(row.appCache),
    libraryEntries: Number(row.libraryEntries),
    selectedGames: Number(row.selectedGames),
  };
}

function readAccountCounts() {
  const rows = sqlite
    .prepare(
      `
      SELECT
        accountId,
        sum(selectedGameCount) AS selectedGameCount,
        sum(libraryAppCount) AS libraryAppCount,
        sum(presetCount) AS presetCount,
        sum(scheduleCount) AS scheduleCount,
        sum(eventCount) AS eventCount
      FROM (
        SELECT account_id AS accountId, count(*) AS selectedGameCount, 0 AS libraryAppCount, 0 AS presetCount, 0 AS scheduleCount, 0 AS eventCount
        FROM steam_account_game GROUP BY account_id
        UNION ALL
        SELECT account_id, 0, count(*), 0, 0, 0
        FROM steam_account_library GROUP BY account_id
        UNION ALL
        SELECT account_id, 0, 0, count(*), 0, 0
        FROM boost_preset GROUP BY account_id
        UNION ALL
        SELECT account_id, 0, 0, 0, count(*), 0
        FROM boost_schedule GROUP BY account_id
        UNION ALL
        SELECT account_id, 0, 0, 0, 0, count(*)
        FROM steam_event WHERE account_id IS NOT NULL GROUP BY account_id
      ) counts
      GROUP BY accountId
      `,
    )
    .all() as Array<{ accountId: string } & AccountCounts>;

  return new Map(
    rows.map((row) => [
      row.accountId,
      {
        selectedGameCount: Number(row.selectedGameCount),
        libraryAppCount: Number(row.libraryAppCount),
        presetCount: Number(row.presetCount),
        scheduleCount: Number(row.scheduleCount),
        eventCount: Number(row.eventCount),
      } satisfies AccountCounts,
    ]),
  );
}

function readAdminPresets(): AdminPresetSummary[] {
  return sqlite
    .prepare(
      `
      SELECT
        preset.id,
        preset.account_id as accountId,
        account.account_name as accountName,
        preset.name,
        preset.persona_state as personaState,
        preset.custom_title as customTitle,
        preset.created_at as createdAt,
        preset.updated_at as updatedAt,
        count(game.app_id) as appCount
      FROM boost_preset preset
      LEFT JOIN steam_account account ON account.id = preset.account_id
      LEFT JOIN boost_preset_game game ON game.preset_id = preset.id
      GROUP BY preset.id
      ORDER BY preset.updated_at DESC
      LIMIT 200
      `,
    )
    .all()
    .map((row) => {
      const item = row as Omit<AdminPresetSummary, "personaState"> & {
        personaState: number;
      };
      if (!isPersonaState(item.personaState)) {
        throw new Error(
          `Unsupported Steam persona state: ${item.personaState}`,
        );
      }
      return {
        ...item,
        personaState: item.personaState,
        appCount: Number(item.appCount),
      } satisfies AdminPresetSummary;
    });
}

function readAdminSchedules(): AdminScheduleSummary[] {
  return sqlite
    .prepare(
      `
      SELECT
        schedule.id,
        schedule.account_id as accountId,
        account.account_name as accountName,
        schedule.preset_id as presetId,
        preset.name as presetName,
        schedule.name,
        schedule.enabled,
        schedule.weekdays_json as weekdaysJson,
        schedule.start_time as startTime,
        schedule.end_time as endTime,
        schedule.timezone,
        schedule.created_at as createdAt,
        schedule.updated_at as updatedAt
      FROM boost_schedule schedule
      LEFT JOIN steam_account account ON account.id = schedule.account_id
      LEFT JOIN boost_preset preset ON preset.id = schedule.preset_id
      ORDER BY schedule.updated_at DESC
      LIMIT 200
      `,
    )
    .all()
    .map((row) => {
      const { enabled, weekdaysJson, ...schedule } = row as Omit<
        AdminScheduleSummary,
        "enabled" | "weekdays"
      > & {
        enabled: 0 | 1 | boolean;
        weekdaysJson: string;
      };
      return {
        ...schedule,
        enabled: Boolean(enabled),
        weekdays: parseIntegerArray(weekdaysJson),
      } satisfies AdminScheduleSummary;
    });
}

function readAdminAppCache(): AdminAppSummary[] {
  return sqlite
    .prepare(
      `
      WITH library_counts AS (
        SELECT app_id, count(*) AS accountCount
        FROM steam_account_library GROUP BY app_id
      ), selected_counts AS (
        SELECT app_id, count(*) AS accountCount
        FROM steam_account_game GROUP BY app_id
      ), preset_counts AS (
        SELECT app_id, count(*) AS presetCount
        FROM boost_preset_game GROUP BY app_id
      )
      SELECT
        app.app_id as appId,
        app.name,
        app.playtime_forever as playtimeForever,
        app.source,
        app.updated_at as updatedAt,
        coalesce(library_counts.accountCount, 0) as libraryAccountCount,
        coalesce(selected_counts.accountCount, 0) as selectedAccountCount,
        coalesce(preset_counts.presetCount, 0) as presetCount
      FROM steam_app_cache app
      LEFT JOIN library_counts ON library_counts.app_id = app.app_id
      LEFT JOIN selected_counts ON selected_counts.app_id = app.app_id
      LEFT JOIN preset_counts ON preset_counts.app_id = app.app_id
      ORDER BY app.updated_at DESC
      LIMIT 200
      `,
    )
    .all()
    .map((row) => {
      const item = row as AdminAppSummary;
      return {
        ...item,
        playtimeForever: Number(item.playtimeForever ?? 0),
        libraryAccountCount: Number(item.libraryAccountCount),
        selectedAccountCount: Number(item.selectedAccountCount),
        presetCount: Number(item.presetCount),
      } satisfies AdminAppSummary;
    });
}
