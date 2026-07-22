import { db, sqlite } from "../db/client.js";
import { and, eq } from "drizzle-orm";
import { boostSchedule, scheduleException } from "../db/schema.js";

export type ScheduleRecord = typeof boostSchedule.$inferSelect;

export type OpenScheduleWindow = {
  scheduleId: string;
  windowId: string;
};

export type StartedScheduleWindow = OpenScheduleWindow & {
  accountId: string;
  expectedUpdatedAt: number;
  previousWindows: OpenScheduleWindow[];
};

export interface ScheduleRepository {
  listAccountIds(): Promise<string[]>;
  listSchedulesForAccount(accountId: string): Promise<ScheduleRecord[]>;
  markWindowsStopped(
    accountId: string,
    windows: OpenScheduleWindow[],
  ): Promise<void>;
  commitStartedWindow(window: StartedScheduleWindow): Promise<void>;
  isWindowSkipped?(
    accountId: string,
    scheduleId: string,
    windowId: string,
  ): Promise<boolean>;
}

export class SqliteScheduleRepository implements ScheduleRepository {
  async listAccountIds() {
    const rows = await db
      .selectDistinct({ accountId: boostSchedule.accountId })
      .from(boostSchedule);
    return rows.map((row) => row.accountId);
  }

  async listSchedulesForAccount(accountId: string) {
    return db.query.boostSchedule.findMany({
      where: (schedule, { eq }) => eq(schedule.accountId, accountId),
    });
  }

  async markWindowsStopped(accountId: string, windows: OpenScheduleWindow[]) {
    if (windows.length === 0) return;

    const markStopped = sqlite.transaction(() => {
      const update = sqlite.prepare(`
        UPDATE boost_schedule
        SET last_stopped_window = ?
        WHERE id = ?
          AND account_id = ?
          AND last_started_window = ?
      `);
      for (const window of windows) {
        const result = update.run(
          window.windowId,
          window.scheduleId,
          accountId,
          window.windowId,
        );
        requireSingleScheduleUpdate(result.changes, window.scheduleId, "stop");
      }
    });
    markStopped();
  }

  async commitStartedWindow(window: StartedScheduleWindow) {
    const commit = sqlite.transaction(() => {
      const stopPrevious = sqlite.prepare(`
        UPDATE boost_schedule
        SET last_stopped_window = ?
        WHERE id = ?
          AND account_id = ?
          AND last_started_window = ?
      `);
      for (const previous of window.previousWindows) {
        if (
          previous.scheduleId === window.scheduleId &&
          previous.windowId === window.windowId
        ) {
          continue;
        }
        const result = stopPrevious.run(
          previous.windowId,
          previous.scheduleId,
          window.accountId,
          previous.windowId,
        );
        requireSingleScheduleUpdate(
          result.changes,
          previous.scheduleId,
          "stop previous",
        );
      }

      const started = sqlite
        .prepare(
          `
            UPDATE boost_schedule
            SET last_started_window = ?,
                last_stopped_window = CASE
                  WHEN last_stopped_window = ? THEN NULL
                  ELSE last_stopped_window
                END
            WHERE id = ?
              AND account_id = ?
              AND enabled = 1
              AND updated_at = ?
          `,
        )
        .run(
          window.windowId,
          window.windowId,
          window.scheduleId,
          window.accountId,
          window.expectedUpdatedAt,
        );
      requireSingleScheduleUpdate(started.changes, window.scheduleId, "start");
    });
    commit();
  }

  async isWindowSkipped(
    accountId: string,
    scheduleId: string,
    windowId: string,
  ) {
    const exception = await db.query.scheduleException.findFirst({
      where: and(
        eq(scheduleException.accountId, accountId),
        eq(scheduleException.scheduleId, scheduleId),
        eq(scheduleException.windowId, windowId),
        eq(scheduleException.action, "skip"),
      ),
    });
    return Boolean(exception);
  }
}

export const scheduleRepository = new SqliteScheduleRepository();

function requireSingleScheduleUpdate(
  changes: number,
  scheduleId: string,
  action: string,
) {
  if (changes === 1) return;
  throw new Error(
    `Schedule marker ${action} rejected for schedule ${scheduleId}.`,
  );
}
