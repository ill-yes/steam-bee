import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import Database from "better-sqlite3";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstanceLease, InstanceLeaseError } from "../src/instance-lease.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("InstanceLease", () => {
  it("creates only the lease in a previously missing data directory", () => {
    const root = temporaryDirectory();
    const dataDir = join(root, "new-data");
    const lease = new InstanceLease(dataDir, () => 1_000);

    expect(existsSync(dataDir)).toBe(false);
    lease.acquire();

    expect(
      readdirSync(dataDir).every((name) =>
        name.startsWith(".steam-bee-instance"),
      ),
    ).toBe(true);
    expect(existsSync(join(dataDir, "steam-bee.sqlite"))).toBe(false);
    expect(existsSync(join(dataDir, "instance.secret"))).toBe(false);
    expect(existsSync(join(dataDir, "steam-data"))).toBe(false);

    lease.release();
    expect(lstatSync(join(dataDir, ".steam-bee-instance")).isFile()).toBe(true);
    expect(lstatSync(join(dataDir, ".steam-bee-instance")).mode & 0o777).toBe(
      0o600,
    );
  });

  it("allows only one owner for the same data directory", () => {
    const directory = temporaryDirectory();
    const first = new InstanceLease(directory, () => 1_000);
    const second = new InstanceLease(directory, () => 1_000);

    expect(first.acquire()).toMatchObject({ state: "held" });
    expect(() => second.acquire()).toThrow(InstanceLeaseError);

    first.release();
    expect(second.acquire()).toMatchObject({ state: "held" });
    second.release();
  });

  it("recovers an empty guard left by an interrupted initialization without replacing it", () => {
    const directory = temporaryDirectory();
    const path = join(directory, ".steam-bee-instance");
    writeFileSync(path, "", { mode: 0o600 });
    const inode = lstatSync(path).ino;
    const lease = new InstanceLease(directory);
    expect(lease.acquire()).toMatchObject({ state: "held" });
    lease.release();
    expect(lstatSync(path).ino).toBe(inode);
  });

  it("fails closed instead of taking over an expired runtime heartbeat", () => {
    const directory = temporaryDirectory();
    const oldLease = new InstanceLease(directory, () => 1_000);
    const replacement = new InstanceLease(directory, () => 122_000);
    oldLease.acquire();

    expect(() => replacement.acquire()).toThrow(InstanceLeaseError);
    oldLease.release();
    expect(replacement.acquire()).toMatchObject({ state: "held" });
    replacement.release();
  });

  it("never takes over an offline restore lease as stale", () => {
    const directory = temporaryDirectory();
    const restore = new InstanceLease(directory, () => 1_000, {
      ownerKind: "restore",
    });
    const runtime = new InstanceLease(directory, () => 1_000_000);
    restore.acquire();

    expect(() => runtime.acquire()).toThrow(InstanceLeaseError);

    restore.completeRestore();
    restore.release();
    expect(runtime.acquire()).toMatchObject({ state: "held" });
    runtime.release();
  });

  it("retains restore_required across generic release for both runtime and restore", () => {
    const directory = temporaryDirectory();
    const restore = new InstanceLease(directory, Date.now, {
      ownerKind: "restore",
    });
    restore.acquire();
    restore.release();
    for (const ownerKind of ["runtime", "restore"] as const) {
      expect(() =>
        new InstanceLease(directory, Date.now, { ownerKind }).acquire(),
      ).toThrow(/restore_required/);
    }
  });

  it("updates heartbeat in memory without modifying the guard file", () => {
    const directory = temporaryDirectory();
    vi.useFakeTimers();
    let now = 1_000;
    const lease = new InstanceLease(directory, () => now);
    try {
      lease.acquire();
      const before = lstatSync(join(directory, ".steam-bee-instance"));
      now = 21_000;
      vi.advanceTimersByTime(20_000);
      expect(lease.status().heartbeatAt).toBe(21_000);
      const after = lstatSync(join(directory, ".steam-bee-instance"));
      expect(after.mtimeMs).toBe(before.mtimeMs);
      expect(after.ino).toBe(before.ino);
    } finally {
      lease.release();
      vi.useRealTimers();
    }
  });

  it("rejects a FIFO guard without opening it", () => {
    const directory = temporaryDirectory();
    const path = join(directory, ".steam-bee-instance");
    expect(spawnSync("mkfifo", ["-m", "600", path]).status).toBe(0);
    expect(() => new InstanceLease(directory).acquire()).toThrow(
      /regular file/,
    );
    expect(lstatSync(path).isFIFO()).toBe(true);
  });

  it.each(["-journal", "-wal", "-shm"])(
    "rejects unsafe %s sidecars before SQLite opens them",
    (suffix) => {
      const directory = temporaryDirectory();
      writeFileSync(join(directory, ".steam-bee-instance"), "", {
        mode: 0o600,
      });
      const target = join(directory, "untouched");
      writeFileSync(target, "untouched", { mode: 0o600 });
      symlinkSync(target, join(directory, `.steam-bee-instance${suffix}`));
      expect(() => new InstanceLease(directory).acquire()).toThrow(/sidecar/);
      expect(
        lstatSync(
          join(directory, `.steam-bee-instance${suffix}`),
        ).isSymbolicLink(),
      ).toBe(true);
    },
  );

  it.each([
    "legacy",
    "symlink",
    "hardlink",
    "public",
    "corrupt",
    "unknown-schema",
    "unknown-version",
    "missing-owner",
  ])("rejects %s guards without replacing or repairing them", (kind) => {
    const directory = temporaryDirectory();
    const path = join(directory, ".steam-bee-instance");
    if (kind === "legacy") mkdirSync(path);
    else if (kind === "symlink") symlinkSync(join(directory, "missing"), path);
    else if (
      kind === "unknown-schema" ||
      kind === "unknown-version" ||
      kind === "missing-owner"
    ) {
      const lease = new InstanceLease(directory);
      lease.acquire();
      lease.release();
      const database = new Database(path);
      if (kind === "unknown-schema")
        database.exec("CREATE TABLE unexpected (value TEXT)");
      else if (kind === "unknown-version") database.pragma("user_version = 2");
      else database.exec("DELETE FROM instance_guard");
      database.close();
    } else {
      writeFileSync(path, kind === "corrupt" ? "not sqlite" : "", {
        mode: 0o600,
      });
      if (kind === "hardlink") linkSync(path, join(directory, "other"));
      if (kind === "public") chmodSync(path, 0o644);
    }
    const inode = lstatSync(path).ino;
    expect(() => new InstanceLease(directory).acquire()).toThrow(
      InstanceLeaseError,
    );
    expect(lstatSync(path).ino).toBe(inode);
  });
});

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "steam-bee-lease-test-"));
  directories.push(directory);
  return directory;
}
