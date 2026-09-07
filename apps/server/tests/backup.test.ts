import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { decryptBackup, encryptBackup } from "../src/backup/format.js";
import { InstanceLease } from "../src/instance-lease.js";
import {
  IncompleteRestoreRollbackError,
  restoreBackup,
} from "../src/restore.js";

describe("encrypted backup format", () => {
  const entries = [
    { path: "steam-bee.sqlite", data: Buffer.from("sqlite snapshot") },
    {
      path: "instance.secret",
      data: Buffer.from(Buffer.alloc(32, 7).toString("base64")),
    },
  ];

  it("round-trips the required recovery entries", () => {
    const encrypted = encryptBackup(
      entries,
      "correct horse battery staple",
      "008_notifications",
      123,
    );
    const restored = decryptBackup(encrypted, "correct horse battery staple");
    expect(restored.manifest).toMatchObject({
      formatVersion: 1,
      migrationId: "008_notifications",
      createdAt: 123,
    });
    expect(restored.entries).toEqual(entries);
  });

  it("rejects a wrong passphrase or tampered ciphertext", () => {
    const encrypted = encryptBackup(
      entries,
      "correct horse battery staple",
      null,
    );
    expect(() => decryptBackup(encrypted, "wrong passphrase here")).toThrow(
      /decrypted|tampered/i,
    );
    const envelope = JSON.parse(encrypted.toString("utf8")) as {
      ciphertext: string;
    };
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -4)}AAAA`;
    expect(() =>
      decryptBackup(
        Buffer.from(JSON.stringify(envelope)),
        "correct horse battery staple",
      ),
    ).toThrow();
  });

  it("preflights and installs a real SQLite snapshot while retaining rollback data", () => {
    const root = mkdtempSync(join(tmpdir(), "steam-bee-restore-test-"));
    const dataDir = join(root, "data");
    const inputPath = join(root, "backup.sbb");
    const backupDatabase = join(root, "backup.sqlite");
    const currentSecret = Buffer.alloc(32, 3).toString("base64");
    const backupSecret = Buffer.alloc(32, 9).toString("base64");
    mkdirSync(dataDir, { mode: 0o700 });

    try {
      createDatabase(
        join(dataDir, "steam-bee.sqlite"),
        "005_app_read_model_indexes",
        "before",
      );
      writeFileSync(join(dataDir, "instance.secret"), currentSecret);
      createDatabase(backupDatabase, "011_automatic_session_recovery", "after");
      writeFileSync(
        inputPath,
        encryptBackup(
          [
            {
              path: "steam-bee.sqlite",
              data: readFileSync(backupDatabase),
            },
            { path: "instance.secret", data: Buffer.from(backupSecret) },
          ],
          "correct horse battery staple",
          "011_automatic_session_recovery",
        ),
      );

      const result = restoreBackup({
        inputPath,
        dataDir,
        passphrase: "correct horse battery staple",
      });

      expect(readProbe(join(dataDir, "steam-bee.sqlite"))).toBe("after");
      expect(readFileSync(join(dataDir, "instance.secret"), "utf8")).toBe(
        backupSecret,
      );
      expect(
        readProbe(join(result.rollbackDirectory, "steam-bee.sqlite")),
      ).toBe("before");
      expect(
        readFileSync(join(result.rollbackDirectory, "instance.secret"), "utf8"),
      ).toBe(currentSecret);
      expect(existsSync(join(dataDir, ".steam-bee-restore-staging"))).toBe(
        false,
      );
      expect(existsSync(join(dataDir, ".steam-bee-instance"))).toBe(true);
      const runtimeLease = new InstanceLease(dataDir);
      expect(runtimeLease.acquire().state).toBe("held");
      runtimeLease.release();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses restore while the data directory has a runtime owner", () => {
    const root = mkdtempSync(join(tmpdir(), "steam-bee-restore-lock-test-"));
    const dataDir = join(root, "data");
    mkdirSync(dataDir, { mode: 0o700 });
    const runtimeLease = new InstanceLease(dataDir);

    try {
      runtimeLease.acquire();
      expect(() =>
        restoreBackup({
          inputPath: join(root, "not-read-while-contended.sbb"),
          dataDir,
          passphrase: "correct horse battery staple",
        }),
      ).toThrow(/still running|another restore/i);
      expect(runtimeLease.status().state).toBe("held");
    } finally {
      runtimeLease.release();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("clears its fence after a harmless input failure", () => {
    const dataDir = mkdtempSync(
      join(tmpdir(), "steam-bee-restore-harmless-test-"),
    );
    try {
      expect(() =>
        restoreBackup({
          inputPath: join(dataDir, "missing.sbb"),
          dataDir,
          passphrase: "correct horse battery staple",
        }),
      ).toThrow(/ENOENT/);
      const runtime = new InstanceLease(dataDir);
      expect(runtime.acquire().state).toBe("held");
      runtime.release();
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("clears its fence only after a complete verified install rollback", () => {
    const root = mkdtempSync(
      join(tmpdir(), "steam-bee-restore-complete-rollback-test-"),
    );
    const dataDir = join(root, "data");
    mkdirSync(dataDir, { mode: 0o700 });
    try {
      const originalDatabasePath = join(dataDir, "steam-bee.sqlite");
      const originalSecret = Buffer.alloc(32, 3).toString("base64");
      createDatabase(originalDatabasePath, "001_initial_schema", "before");
      writeFileSync(join(dataDir, "instance.secret"), originalSecret);
      const snapshotPath = join(root, "snapshot.sqlite");
      createDatabase(snapshotPath, "001_initial_schema", "after");
      const inputPath = join(root, "backup.sbb");
      writeFileSync(
        inputPath,
        encryptBackup(
          [
            { path: "steam-bee.sqlite", data: readFileSync(snapshotPath) },
            {
              path: "instance.secret",
              data: Buffer.from(Buffer.alloc(32, 9).toString("base64")),
            },
          ],
          "correct horse battery staple",
          "001_initial_schema",
        ),
      );
      expect(() =>
        restoreBackup({
          inputPath,
          dataDir,
          passphrase: "correct horse battery staple",
          fileOperations: {
            rename: ((source: string, destination: string) => {
              if (
                source ===
                join(dataDir, ".steam-bee-restore-staging", "instance.secret")
              )
                throw new Error("injected install failure");
              renameSync(source, destination);
            }) as typeof renameSync,
          },
        }),
      ).toThrow("injected install failure");
      expect(readProbe(originalDatabasePath)).toBe("before");
      expect(readFileSync(join(dataDir, "instance.secret"), "utf8")).toBe(
        originalSecret,
      );
      expect(existsSync(join(dataDir, ".steam-bee-restore-staging"))).toBe(
        false,
      );
      expect(existsSync(join(dataDir, ".steam-bee-restore-rollback"))).toBe(
        false,
      );
      const runtime = new InstanceLease(dataDir);
      expect(runtime.acquire().state).toBe("held");
      runtime.release();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retains the lease and recovery material when install and rollback both fail", () => {
    const root = mkdtempSync(join(tmpdir(), "steam-bee-rollback-fault-test-"));
    const dataDir = join(root, "data");
    const inputPath = join(root, "backup.sbb");
    const backupDatabase = join(root, "backup.sqlite");
    const currentSecret = Buffer.alloc(32, 3).toString("base64");
    const backupSecret = Buffer.alloc(32, 9).toString("base64");
    const staging = join(dataDir, ".steam-bee-restore-staging");
    const rollback = join(dataDir, ".steam-bee-restore-rollback");
    mkdirSync(dataDir, { mode: 0o700 });

    try {
      createDatabase(
        join(dataDir, "steam-bee.sqlite"),
        "005_app_read_model_indexes",
        "before",
      );
      writeFileSync(join(dataDir, "instance.secret"), currentSecret);
      createDatabase(
        backupDatabase,
        "009_timed_hold_schedule_ownership",
        "after",
      );
      writeFileSync(
        inputPath,
        encryptBackup(
          [
            {
              path: "steam-bee.sqlite",
              data: readFileSync(backupDatabase),
            },
            { path: "instance.secret", data: Buffer.from(backupSecret) },
          ],
          "correct horse battery staple",
          "009_timed_hold_schedule_ownership",
        ),
      );

      const rename = ((source: string, destination: string) => {
        if (source === join(staging, "instance.secret")) {
          throw new Error("injected install failure");
        }
        if (source === join(rollback, "instance.secret")) {
          throw new Error("injected rollback failure");
        }
        renameSync(source, destination);
      }) as typeof renameSync;

      let failure: unknown;
      try {
        restoreBackup({
          inputPath,
          dataDir,
          passphrase: "correct horse battery staple",
          fileOperations: { rename },
        });
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(IncompleteRestoreRollbackError);
      expect(failure).toMatchObject({
        stagingDirectory: staging,
        rollbackDirectory: rollback,
      });
      expect(existsSync(join(dataDir, ".steam-bee-instance"))).toBe(true);
      expect(existsSync(staging)).toBe(true);
      expect(existsSync(rollback)).toBe(true);
      expect(() => new InstanceLease(dataDir).acquire()).toThrow(
        /restore_required/,
      );
      expect(() =>
        restoreBackup({
          inputPath,
          dataDir,
          passphrase: "correct horse battery staple",
        }),
      ).toThrow(/restore_required/);
      expect(readProbe(join(rollback, "steam-bee.sqlite"))).toBe("before");
      expect(readFileSync(join(rollback, "instance.secret"), "utf8")).toBe(
        currentSecret,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function createDatabase(path: string, migrationId: string, value: string) {
  const database = new Database(path);
  try {
    database.exec(`
      CREATE TABLE app_migration (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
      CREATE TABLE recovery_probe (value TEXT NOT NULL);
    `);
    const insertMigration = database.prepare(
      "INSERT INTO app_migration (id, description, applied_at) VALUES (?, ?, ?)",
    );
    const currentIndex = migrationIds.indexOf(migrationId);
    for (const [index, id] of migrationIds.entries()) {
      if (index > currentIndex) break;
      insertMigration.run(id, "test", Date.now() + index);
    }
    database
      .prepare("INSERT INTO recovery_probe (value) VALUES (?)")
      .run(value);
  } finally {
    database.close();
  }
}

const migrationIds = [
  "001_initial_schema",
  "002_operational_indexes",
  "003_presets_schedules_analytics",
  "004_single_admin_and_preset_integrity",
  "005_app_read_model_indexes",
  "006_operational_safety_foundation",
  "007_schedule_exceptions_groups_goals",
  "008_notifications",
  "009_timed_hold_schedule_ownership",
  "010_timed_hold_ownership_provenance",
  "011_automatic_session_recovery",
];

function readProbe(path: string) {
  const database = new Database(path, { readonly: true, fileMustExist: true });
  try {
    return (
      database.prepare("SELECT value FROM recovery_probe").get() as {
        value: string;
      }
    ).value;
  } finally {
    database.close();
  }
}
