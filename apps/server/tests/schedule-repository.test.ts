import { beforeEach, describe, expect, it } from "vitest";
import { migrate, sqlite } from "../src/db/client.js";
import { SqliteScheduleRepository } from "../src/steam/schedule-repository.js";

const accountId = "11111111-1111-4111-8111-111111111111";
const firstWindow = "schedule-a:2026-07-08:10:00-11:00";
const secondWindow = "schedule-b:2026-07-08:10:15-12:00";

describe("SqliteScheduleRepository", () => {
  const repository = new SqliteScheduleRepository();

  beforeEach(() => {
    migrate();
    sqlite.exec(`
      DELETE FROM boost_schedule;
      DELETE FROM boost_preset_game;
      DELETE FROM boost_preset;
      DELETE FROM steam_account;
      INSERT INTO steam_account (
        id, account_name, status, desired_state, persona_state,
        token_key_version, created_at, updated_at
      ) VALUES (
        '${accountId}', 'schedule.repository', 'disconnected', 'stopped', 7,
        1, 1, 1
      );
      INSERT INTO boost_preset (
        id, account_id, name, persona_state, created_at, updated_at
      ) VALUES
        ('preset-a', '${accountId}', 'Preset A', 7, 1, 1),
        ('preset-b', '${accountId}', 'Preset B', 7, 1, 1);
      INSERT INTO boost_schedule (
        id, account_id, preset_id, name, enabled, weekdays_json,
        start_time, end_time, timezone, created_at, updated_at
      ) VALUES
        (
          'schedule-a', '${accountId}', 'preset-a', 'Schedule A', 1, '[3]',
          '10:00', '11:00', 'UTC', 1, 1
        ),
        (
          'schedule-b', '${accountId}', 'preset-b', 'Schedule B', 1, '[3]',
          '10:15', '12:00', 'UTC', 1, 1
        );
    `);
  });

  it("commits a winner switch and exact stop markers together", async () => {
    await repository.commitStartedWindow({
      accountId,
      scheduleId: "schedule-a",
      windowId: firstWindow,
      expectedUpdatedAt: 1,
      previousWindows: [],
    });
    await repository.commitStartedWindow({
      accountId,
      scheduleId: "schedule-b",
      windowId: secondWindow,
      expectedUpdatedAt: 1,
      previousWindows: [{ scheduleId: "schedule-a", windowId: firstWindow }],
    });
    await repository.markWindowsStopped(accountId, [
      { scheduleId: "schedule-b", windowId: secondWindow },
    ]);

    expect(readMarkers()).toEqual([
      {
        id: "schedule-a",
        lastStartedWindow: firstWindow,
        lastStoppedWindow: firstWindow,
      },
      {
        id: "schedule-b",
        lastStartedWindow: secondWindow,
        lastStoppedWindow: secondWindow,
      },
    ]);
  });

  it("rolls back the new start marker when closing the previous window fails", async () => {
    await repository.commitStartedWindow({
      accountId,
      scheduleId: "schedule-a",
      windowId: firstWindow,
      expectedUpdatedAt: 1,
      previousWindows: [],
    });
    sqlite.exec(`
      CREATE TRIGGER reject_previous_schedule_stop
      BEFORE UPDATE OF last_stopped_window ON boost_schedule
      WHEN OLD.id = 'schedule-a'
      BEGIN
        SELECT RAISE(ABORT, 'previous schedule stop rejected');
      END;
    `);

    try {
      await expect(
        repository.commitStartedWindow({
          accountId,
          scheduleId: "schedule-b",
          windowId: secondWindow,
          expectedUpdatedAt: 1,
          previousWindows: [
            { scheduleId: "schedule-a", windowId: firstWindow },
          ],
        }),
      ).rejects.toThrow("previous schedule stop rejected");
    } finally {
      sqlite.exec("DROP TRIGGER reject_previous_schedule_stop;");
    }

    expect(readMarkers()).toEqual([
      {
        id: "schedule-a",
        lastStartedWindow: firstWindow,
        lastStoppedWindow: null,
      },
      {
        id: "schedule-b",
        lastStartedWindow: null,
        lastStoppedWindow: null,
      },
    ]);
  });

  it("keeps account scope and rolls back a start when a predecessor is stale", async () => {
    const otherAccountId = "22222222-2222-4222-8222-222222222222";
    const otherWindow = "schedule-c:2026-07-08:09:00-13:00";
    sqlite.exec(`
      INSERT INTO steam_account (
        id, account_name, status, desired_state, persona_state,
        token_key_version, created_at, updated_at
      ) VALUES (
        '${otherAccountId}', 'schedule.repository.other', 'disconnected',
        'stopped', 7, 1, 1, 1
      );
      INSERT INTO boost_preset (
        id, account_id, name, persona_state, created_at, updated_at
      ) VALUES (
        'preset-c', '${otherAccountId}', 'Preset C', 7, 1, 1
      );
      INSERT INTO boost_schedule (
        id, account_id, preset_id, name, enabled, weekdays_json,
        start_time, end_time, timezone, last_started_window,
        created_at, updated_at
      ) VALUES (
        'schedule-c', '${otherAccountId}', 'preset-c', 'Schedule C', 1, '[3]',
        '09:00', '13:00', 'UTC', '${otherWindow}', 1, 1
      );
    `);

    await expect(
      repository.commitStartedWindow({
        accountId,
        scheduleId: "schedule-b",
        windowId: secondWindow,
        expectedUpdatedAt: 1,
        previousWindows: [{ scheduleId: "schedule-c", windowId: otherWindow }],
      }),
    ).rejects.toThrow("stop previous rejected");

    expect(readMarkers()).toEqual([
      {
        id: "schedule-a",
        lastStartedWindow: null,
        lastStoppedWindow: null,
      },
      {
        id: "schedule-b",
        lastStartedWindow: null,
        lastStoppedWindow: null,
      },
      {
        id: "schedule-c",
        lastStartedWindow: otherWindow,
        lastStoppedWindow: null,
      },
    ]);
  });

  it("rejects zero-row winner updates without touching another account", async () => {
    await expect(
      repository.commitStartedWindow({
        accountId: "22222222-2222-4222-8222-222222222222",
        scheduleId: "schedule-a",
        windowId: firstWindow,
        expectedUpdatedAt: 1,
        previousWindows: [],
      }),
    ).rejects.toThrow("start rejected");

    expect(readMarkers()[0]).toEqual({
      id: "schedule-a",
      lastStartedWindow: null,
      lastStoppedWindow: null,
    });
  });

  it("reopens the same closed window and preserves a prior window", async () => {
    const nextWindow = "schedule-a:2026-07-15:10:00-11:00";
    await repository.commitStartedWindow({
      accountId,
      scheduleId: "schedule-a",
      windowId: firstWindow,
      expectedUpdatedAt: 1,
      previousWindows: [],
    });
    await repository.markWindowsStopped(accountId, [
      { scheduleId: "schedule-a", windowId: firstWindow },
    ]);
    await repository.commitStartedWindow({
      accountId,
      scheduleId: "schedule-a",
      windowId: firstWindow,
      expectedUpdatedAt: 1,
      previousWindows: [],
    });

    expect(readMarkers()[0]).toEqual({
      id: "schedule-a",
      lastStartedWindow: firstWindow,
      lastStoppedWindow: null,
    });

    await repository.commitStartedWindow({
      accountId,
      scheduleId: "schedule-a",
      windowId: nextWindow,
      expectedUpdatedAt: 1,
      previousWindows: [{ scheduleId: "schedule-a", windowId: firstWindow }],
    });
    expect(readMarkers()[0]).toEqual({
      id: "schedule-a",
      lastStartedWindow: nextWindow,
      lastStoppedWindow: firstWindow,
    });
  });
});

function readMarkers() {
  return sqlite
    .prepare(
      `
        SELECT
          id,
          last_started_window as lastStartedWindow,
          last_stopped_window as lastStoppedWindow
        FROM boost_schedule
        ORDER BY id
      `,
    )
    .all();
}
