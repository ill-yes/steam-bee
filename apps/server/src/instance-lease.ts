import { closeSync, constants, lstatSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { InstanceLeaseStatus } from "@steam-bee/contracts";

const heartbeatIntervalMs = 10_000;
const applicationId = 0x53424947;
const schemaVersion = 1;
const schema = `CREATE TABLE instance_guard (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  owner_id TEXT NOT NULL,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('runtime', 'restore')),
  pid INTEGER NOT NULL,
  acquired_at INTEGER NOT NULL,
  restore_required INTEGER NOT NULL CHECK (restore_required IN (0, 1))
)`;

type LeaseMetadata = {
  ownerId: string;
  ownerKind: "runtime" | "restore";
  acquiredAt: number;
  heartbeatAt: number;
};

type InstanceLeaseOptions = {
  ownerKind?: LeaseMetadata["ownerKind"];
};

// Opening and closing another descriptor for a held inode can drop POSIX locks.
// Reject duplicate owners in this process before SQLite opens that inode.
const heldInodes = new Set<string>();

export class InstanceLeaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstanceLeaseError";
  }
}

export class InstanceLease {
  private readonly guardPath: string;
  private readonly ownerId = randomUUID();
  private database: Database.Database | null = null;
  private inode: string | null = null;
  private metadata: LeaseMetadata | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private state: InstanceLeaseStatus["state"] = "idle";
  private lostHandler: ((error: Error) => void) | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly now: () => number = Date.now,
    private readonly options: InstanceLeaseOptions = {},
  ) {
    this.guardPath = join(dataDir, ".steam-bee-instance");
  }

  onLost(handler: (error: Error) => void) {
    this.lostHandler = handler;
  }

  acquire() {
    if (this.metadata) return this.status();
    let database: Database.Database | null = null;
    try {
      mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
      this.ensureGuardFile();
      const inode = this.guardIdentity();
      if (heldInodes.has(inode))
        throw new Error("Guard already held in this process.");
      this.validateSidecars();
      heldInodes.add(inode);
      this.inode = inode;
      database = new Database(this.guardPath, {
        timeout: 0,
        fileMustExist: true,
      });
      database.pragma("locking_mode = EXCLUSIVE");
      if (database.pragma("journal_mode", { simple: true }) !== "delete") {
        throw new Error(
          "Guard journal mode is not DELETE; manual inspection is required.",
        );
      }
      database.pragma("journal_mode = DELETE");
      database.pragma("synchronous = FULL");
      database.exec("BEGIN EXCLUSIVE");
      const initialized = this.validateSchema(database);
      const previous = database
        .prepare("SELECT * FROM instance_guard")
        .all() as Array<{
        singleton: number;
        owner_id: string;
        owner_kind: string;
        pid: number;
        acquired_at: number;
        restore_required: number;
      }>;
      if (
        previous.length !== (initialized ? 0 : 1) ||
        (previous.length === 1 &&
          (previous[0]!.singleton !== 1 ||
            typeof previous[0]!.owner_id !== "string" ||
            !previous[0]!.owner_id ||
            !["runtime", "restore"].includes(previous[0]!.owner_kind) ||
            !Number.isSafeInteger(previous[0]!.pid) ||
            previous[0]!.pid <= 0 ||
            !Number.isSafeInteger(previous[0]!.acquired_at) ||
            ![0, 1].includes(previous[0]!.restore_required)))
      )
        throw new Error(
          "Guard metadata is invalid; manual inspection is required.",
        );
      if (previous[0]?.restore_required === 1) {
        throw new Error(
          "Incomplete restore: restore_required is set. Offline recovery is required before runtime or restore can start.",
        );
      }
      const acquiredAt = this.now();
      const ownerKind = this.options.ownerKind ?? "runtime";
      database
        .prepare(
          `INSERT OR REPLACE INTO instance_guard
        (singleton, owner_id, owner_kind, pid, acquired_at, restore_required)
        VALUES (1, ?, ?, ?, ?, ?)`,
        )
        .run(
          this.ownerId,
          ownerKind,
          process.pid,
          acquiredAt,
          ownerKind === "restore" ? 1 : 0,
        );
      if (this.guardIdentity() !== inode)
        throw new Error("Guard identity changed during acquisition.");
      database.exec("COMMIT");
      // EXCLUSIVE locking mode retains the OS lock after this durable commit.
      this.database = database;
      this.metadata = {
        ownerId: this.ownerId,
        ownerKind,
        acquiredAt,
        heartbeatAt: acquiredAt,
      };
      this.state = "held";
      this.heartbeatTimer = setInterval(
        () => this.heartbeat(),
        heartbeatIntervalMs,
      );
      this.heartbeatTimer.unref();
      return this.status();
    } catch (error) {
      if (database?.inTransaction) database.exec("ROLLBACK");
      database?.close();
      if (this.inode) heldInodes.delete(this.inode);
      this.inode = null;
      this.state = "contended";
      throw new InstanceLeaseError(
        `Cannot acquire SteamBee DATA_DIR guard ${this.guardPath}: ${error instanceof Error ? error.message : "unknown guard failure"}`,
      );
    }
  }

  // Call only after a verified complete install, complete rollback, or harmless
  // pre-install cleanup. Ordinary release must never remove a restore fence.
  completeRestore() {
    if (!this.database || this.metadata?.ownerKind !== "restore") {
      throw new InstanceLeaseError(
        "Only a held restore owner can clear restore_required.",
      );
    }
    try {
      this.assertIdentity();
      const result = this.database
        .prepare(
          "UPDATE instance_guard SET restore_required = 0 WHERE singleton = 1 AND owner_id = ?",
        )
        .run(this.ownerId);
      if (result.changes !== 1)
        throw new InstanceLeaseError("Restore owner metadata changed.");
    } catch (error) {
      this.failStop(error);
    }
  }

  release() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.database?.close();
    this.database = null;
    if (this.inode) heldInodes.delete(this.inode);
    this.inode = null;
    this.metadata = null;
    this.state = "idle";
  }

  status(): InstanceLeaseStatus {
    return {
      state: this.state,
      ownerId: this.metadata?.ownerId ?? null,
      acquiredAt: this.metadata?.acquiredAt ?? null,
      heartbeatAt: this.metadata?.heartbeatAt ?? null,
    };
  }

  private ensureGuardFile() {
    try {
      lstatSync(this.guardPath);
    } catch (error) {
      if (!isCode(error, "ENOENT")) throw error;
      try {
        const fd = openSync(
          this.guardPath,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        closeSync(fd);
      } catch (createError) {
        if (!isCode(createError, "EEXIST")) throw createError;
      }
    }
  }

  private guardIdentity() {
    const stat = lstatSync(this.guardPath);
    if (stat.isDirectory())
      throw new Error(
        "Legacy directory lease exists; stop all old instances and follow the offline migration procedure.",
      );
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      (stat.mode & 0o7777) !== 0o600
    ) {
      throw new Error(
        "Guard must be a private 0600 regular file with one link; manual inspection is required.",
      );
    }
    return `${stat.dev}:${stat.ino}`;
  }

  private validateSidecars() {
    for (const suffix of ["-journal", "-wal", "-shm"]) {
      try {
        const stat = lstatSync(`${this.guardPath}${suffix}`);
        if (
          suffix !== "-journal" ||
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          stat.nlink !== 1 ||
          (stat.mode & 0o7777) !== 0o600
        ) {
          throw new Error(
            "Unsafe or unsupported guard sidecar; manual inspection is required.",
          );
        }
      } catch (error) {
        if (!isCode(error, "ENOENT")) throw error;
      }
    }
  }

  private validateSchema(database: Database.Database) {
    const version = database.pragma("user_version", { simple: true });
    const appId = database.pragma("application_id", { simple: true });
    const objects = database
      .prepare("SELECT type, name, sql FROM sqlite_master")
      .all() as Array<{ type: string; name: string; sql: string }>;
    if (version === 0 && appId === 0 && objects.length === 0) {
      database.exec(schema);
      database.pragma(`application_id = ${applicationId}`);
      database.pragma(`user_version = ${schemaVersion}`);
      return true;
    }
    if (
      version !== schemaVersion ||
      appId !== applicationId ||
      objects.length !== 1 ||
      objects[0]?.type !== "table" ||
      objects[0]?.name !== "instance_guard" ||
      objects[0]?.sql !== schema
    ) {
      throw new Error(
        "Unknown guard schema or version; manual inspection is required.",
      );
    }
    if (database.pragma("quick_check", { simple: true }) !== "ok") {
      throw new Error(
        "Guard integrity check failed; manual inspection is required.",
      );
    }
    return false;
  }

  private assertIdentity() {
    if (!this.database?.open || this.guardIdentity() !== this.inode) {
      throw new InstanceLeaseError(
        "SteamBee lost its DATA_DIR guard identity.",
      );
    }
  }

  private heartbeat() {
    try {
      this.assertIdentity();
      if (this.metadata) this.metadata.heartbeatAt = this.now();
    } catch (error) {
      this.failStop(error);
    }
  }

  private failStop(error: unknown): never {
    this.state = "contended";
    try {
      this.lostHandler?.(
        error instanceof Error ? error : new Error("Instance guard was lost."),
      );
    } finally {
      // Continuing asynchronous shutdown after ownership loss permits two writers.
      process.exit(1);
    }
  }
}

function isCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
