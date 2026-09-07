import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { decryptBackup } from "./backup/format.js";
import { InstanceLease, InstanceLeaseError } from "./instance-lease.js";

const supportedMigrationIds = [
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
] as const;
const supportedMigrations = new Set<string>(supportedMigrationIds);

export type RestoreOptions = {
  inputPath: string;
  dataDir: string;
  passphrase: string;
  fileOperations?: {
    rename: typeof renameSync;
  };
};

export class IncompleteRestoreRollbackError extends Error {
  readonly installError: unknown;
  readonly rollbackError: unknown;
  readonly stagingDirectory: string;
  readonly rollbackDirectory: string;

  constructor(
    installError: unknown,
    rollbackError: unknown,
    stagingDirectory: string,
    rollbackDirectory: string,
  ) {
    super(
      `Restore installation and rollback both failed. The persistent restore fence and recovery data were retained at ${stagingDirectory} and ${rollbackDirectory}.`,
    );
    this.name = "IncompleteRestoreRollbackError";
    this.installError = installError;
    this.rollbackError = rollbackError;
    this.stagingDirectory = stagingDirectory;
    this.rollbackDirectory = rollbackDirectory;
  }
}

async function main() {
  const input = argument("--input");
  const dataDir = resolve(argument("--data-dir") ?? "/data");
  if (!input)
    throw new Error("Usage: restore --input <backup.sbb> [--data-dir /data]");
  const passphrase = await readPassphrase();
  const result = restoreBackup({ inputPath: input, dataDir, passphrase });
  process.stdout.write(
    `Restore complete. Previous critical files remain in ${result.rollbackDirectory}.\n`,
  );
}

export function restoreBackup(options: RestoreOptions) {
  const dataDir = resolve(options.dataDir);
  assertRestoreRoot(dataDir);
  const restoreLease = new InstanceLease(dataDir, Date.now, {
    ownerKind: "restore",
  });
  let safeToClearFence = true;
  try {
    restoreLease.acquire();
  } catch (error) {
    if (error instanceof InstanceLeaseError) {
      throw new Error(
        `SteamBee is still running, another restore owns the data directory, or offline guard recovery is required. ${error.message}`,
      );
    }
    throw error;
  }
  try {
    const payload = decryptBackup(
      readFileSync(resolve(options.inputPath)),
      options.passphrase,
    );
    if (
      payload.manifest.migrationId &&
      !supportedMigrations.has(payload.manifest.migrationId)
    ) {
      throw new Error(
        `Backup migration ${payload.manifest.migrationId} is newer than this restore tool.`,
      );
    }

    const staging = join(dataDir, ".steam-bee-restore-staging");
    const rollback = join(dataDir, ".steam-bee-restore-rollback");
    if (existsSync(staging) || existsSync(rollback)) {
      throw new Error(
        "Restore staging or rollback data already exists; inspect it before retrying.",
      );
    }
    mkdirSync(staging, { mode: 0o700 });
    safeToClearFence = false;
    try {
      for (const entry of payload.entries) {
        writeFileSync(join(staging, entry.path), entry.data, {
          mode: 0o600,
          flag: "wx",
        });
      }
      validateSecret(join(staging, "instance.secret"));
      validateDatabase(
        join(staging, "steam-bee.sqlite"),
        payload.manifest.migrationId,
      );
      installRestore(
        dataDir,
        staging,
        rollback,
        options.fileOperations?.rename ?? renameSync,
      );
      safeToClearFence = true;
      return { rollbackDirectory: rollback };
    } catch (error) {
      if (error instanceof IncompleteRestoreRollbackError) {
        throw error;
      }
      rmSync(staging, { recursive: true, force: true });
      safeToClearFence = true;
      throw error;
    }
  } finally {
    if (safeToClearFence) restoreLease.completeRestore();
    restoreLease.release();
  }
}

function assertRestoreRoot(path: string) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(
      `Restore data directory is not a regular directory: ${path}`,
    );
  }
}

function installRestore(
  dataDir: string,
  staging: string,
  rollback: string,
  renameFile: typeof renameSync,
) {
  mkdirSync(rollback, { mode: 0o700 });
  const currentFiles = [
    "steam-bee.sqlite",
    "steam-bee.sqlite-wal",
    "steam-bee.sqlite-shm",
    "steam-bee.sqlite-journal",
    "instance.secret",
  ];
  const moved: string[] = [];
  const installed: string[] = [];
  const originalIdentities = new Map<string, string>();
  const replacementIdentities = new Map(
    ["steam-bee.sqlite", "instance.secret"].map((name) => [
      name,
      regularFileIdentity(join(staging, name)),
    ]),
  );
  try {
    for (const name of currentFiles) {
      const source = join(dataDir, name);
      if (!existsSync(source)) continue;
      originalIdentities.set(name, regularFileIdentity(source));
      renameFile(source, join(rollback, name));
      moved.push(name);
    }
    for (const name of ["steam-bee.sqlite", "instance.secret"]) {
      renameFile(join(staging, name), join(dataDir, name));
      installed.push(name);
    }
    for (const [name, identity] of replacementIdentities) {
      if (regularFileIdentity(join(dataDir, name)) !== identity) {
        throw new Error("Installed restore file identity changed.");
      }
    }
    rmSync(staging, { recursive: true, force: true });
  } catch (error) {
    try {
      for (const name of installed.reverse()) {
        const installedPath = join(dataDir, name);
        renameFile(installedPath, join(staging, name));
      }
      for (const name of moved.reverse()) {
        const rollbackPath = join(rollback, name);
        renameFile(rollbackPath, join(dataDir, name));
      }
      for (const [name, identity] of originalIdentities) {
        if (regularFileIdentity(join(dataDir, name)) !== identity) {
          throw new Error(
            "Rollback did not restore the original file identity.",
          );
        }
      }
      rmSync(rollback, { recursive: true, force: true });
    } catch (rollbackError) {
      throw new IncompleteRestoreRollbackError(
        error,
        rollbackError,
        staging,
        rollback,
      );
    }
    throw error;
  }
}

function validateSecret(path: string) {
  assertRegularFile(path);
  const encoded = readFileSync(path, "utf8").trim();
  const decoded = Buffer.from(encoded, "base64");
  if (
    decoded.length !== 32 ||
    decoded.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")
  ) {
    throw new Error("Backup instance.secret is invalid.");
  }
}

function validateDatabase(path: string, manifestMigrationId: string | null) {
  assertRegularFile(path);
  const database = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const integrity = database.pragma("integrity_check", { simple: true });
    if (integrity !== "ok")
      throw new Error("Backup database integrity check failed.");
    const migrationIds = (
      database.prepare("SELECT id FROM app_migration").all() as Array<{
        id: string;
      }>
    ).map((migration) => migration.id);
    const unknownMigration = migrationIds.find(
      (migrationId) => !supportedMigrations.has(migrationId),
    );
    if (unknownMigration) {
      throw new Error(
        `Backup database migration ${unknownMigration} is not supported.`,
      );
    }
    const applied = new Set(migrationIds);
    let currentIndex = -1;
    supportedMigrationIds.forEach((migrationId, index) => {
      if (applied.has(migrationId)) currentIndex = index;
    });
    if (currentIndex < 0) {
      throw new Error("Backup database has no SteamBee migration history.");
    }
    const missingMigration = supportedMigrationIds
      .slice(0, currentIndex + 1)
      .find((migrationId) => !applied.has(migrationId));
    if (missingMigration) {
      throw new Error(
        `Backup database is missing migration ${missingMigration}.`,
      );
    }
    const databaseMigrationId = supportedMigrationIds[currentIndex] ?? null;
    if (manifestMigrationId !== databaseMigrationId) {
      throw new Error(
        "Backup manifest and database migration history do not match.",
      );
    }
  } finally {
    database.close();
  }
}

function assertRegularFile(path: string) {
  regularFileIdentity(path);
}

function regularFileIdentity(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new Error(`Restore path is not a regular file: ${path}`);
  }
  return `${stat.dev}:${stat.ino}`;
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function readPassphrase() {
  if (!process.stdin.isTTY) {
    const terminal = createInterface({ input: process.stdin });
    try {
      return await terminal.question("");
    } finally {
      terminal.close();
    }
  }
  const output = new MutedOutput();
  const terminal = createInterface({
    input: process.stdin,
    output,
    terminal: true,
  });
  try {
    const answer = terminal.question("Backup passphrase: ");
    output.muted = true;
    const passphrase = await answer;
    process.stderr.write("\n");
    return passphrase;
  } finally {
    terminal.close();
  }
}

class MutedOutput extends Writable {
  muted = false;

  _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    if (!this.muted) process.stderr.write(chunk);
    callback();
  }
}

const launchedAsScript =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (launchedAsScript) {
  void main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Restore failed."}\n`,
    );
    process.exitCode = 1;
  });
}
