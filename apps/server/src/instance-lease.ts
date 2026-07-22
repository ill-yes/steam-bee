import {
  mkdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { InstanceLeaseStatus } from "@steam-bee/contracts";

const heartbeatIntervalMs = 10_000;

type LeaseMetadata = {
  ownerId: string;
  ownerKind: "runtime" | "restore";
  pid: number;
  acquiredAt: number;
  heartbeatAt: number;
};

type InstanceLeaseOptions = {
  ownerKind?: LeaseMetadata["ownerKind"];
  fileOperations?: {
    writeFile: typeof writeFileSync;
  };
};

export class InstanceLeaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstanceLeaseError";
  }
}

export class InstanceLease {
  private readonly lockDirectory: string;
  private readonly ownerFile: string;
  private readonly ownerId = randomUUID();
  private metadata: LeaseMetadata | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private state: InstanceLeaseStatus["state"] = "idle";
  private lostHandler: ((error: Error) => void) | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly now: () => number = Date.now,
    private readonly options: InstanceLeaseOptions = {},
  ) {
    this.lockDirectory = join(dataDir, ".steam-bee-instance");
    this.ownerFile = join(this.lockDirectory, "owner.json");
  }

  onLost(handler: (error: Error) => void) {
    this.lostHandler = handler;
  }

  acquire() {
    if (this.metadata) return this.status();

    try {
      this.createLeaseDirectory();
    } catch (error) {
      if (!isCode(error, "EEXIST")) throw error;
      this.state = "contended";
      const owner = this.readMetadata();
      throw new InstanceLeaseError(
        `Another SteamBee instance or restore owns ${this.lockDirectory}${owner ? ` (owner ${owner.ownerId})` : ""}. Confirm it is stopped and resolve the lease before reusing the same DATA_DIR.`,
      );
    }

    const acquiredAt = this.now();
    this.metadata = {
      ownerId: this.ownerId,
      ownerKind: this.options.ownerKind ?? "runtime",
      pid: process.pid,
      acquiredAt,
      heartbeatAt: acquiredAt,
    };
    this.state = "held";
    try {
      this.writeMetadata();
    } catch (error) {
      this.metadata = null;
      this.state = "idle";
      rmSync(this.lockDirectory, { recursive: true, force: true });
      throw error;
    }
    this.heartbeatTimer = setInterval(
      () => this.heartbeat(),
      heartbeatIntervalMs,
    );
    this.heartbeatTimer.unref();
    return this.status();
  }

  release() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;

    if (this.metadata && this.readMetadata()?.ownerId === this.ownerId) {
      rmSync(this.lockDirectory, { recursive: true, force: true });
    }
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

  private createLeaseDirectory() {
    mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    mkdirSync(this.lockDirectory, { mode: 0o700 });
  }

  private heartbeat() {
    try {
      const current = this.readMetadata();
      if (!this.metadata || current?.ownerId !== this.ownerId) {
        throw new InstanceLeaseError(
          "SteamBee lost ownership of its DATA_DIR lease.",
        );
      }
      this.metadata.heartbeatAt = this.now();
      this.writeMetadata();
      const timestamp = new Date(this.metadata.heartbeatAt);
      utimesSync(this.lockDirectory, timestamp, timestamp);
    } catch (error) {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      this.state = "contended";
      this.lostHandler?.(
        error instanceof Error ? error : new Error("Instance lease was lost."),
      );
    }
  }

  private writeMetadata() {
    if (!this.metadata) return;
    const writeFile = this.options.fileOperations?.writeFile ?? writeFileSync;
    writeFile(this.ownerFile, JSON.stringify(this.metadata), {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  private readMetadata(): LeaseMetadata | null {
    try {
      const value = JSON.parse(
        readFileSync(this.ownerFile, "utf8"),
      ) as Partial<LeaseMetadata>;
      if (
        typeof value.ownerId !== "string" ||
        (value.ownerKind !== undefined &&
          value.ownerKind !== "runtime" &&
          value.ownerKind !== "restore") ||
        typeof value.pid !== "number" ||
        typeof value.acquiredAt !== "number" ||
        typeof value.heartbeatAt !== "number"
      ) {
        return null;
      }
      return {
        ...(value as Omit<LeaseMetadata, "ownerKind">),
        ownerKind: value.ownerKind ?? "runtime",
      };
    } catch (error) {
      if (isCode(error, "ENOENT") || error instanceof SyntaxError) return null;
      throw error;
    }
  }
}

function isCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
