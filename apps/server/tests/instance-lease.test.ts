import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

    expect(readdirSync(dataDir)).toEqual([".steam-bee-instance"]);
    expect(existsSync(join(dataDir, "steam-bee.sqlite"))).toBe(false);
    expect(existsSync(join(dataDir, "instance.secret"))).toBe(false);
    expect(existsSync(join(dataDir, "steam-data"))).toBe(false);

    lease.release();
    expect(existsSync(join(dataDir, ".steam-bee-instance"))).toBe(false);
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

  it("removes only its new lease when initial metadata publication fails", () => {
    const directory = temporaryDirectory();
    const lease = new InstanceLease(directory, () => 1_000, {
      fileOperations: {
        writeFile: () => {
          throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
        },
      },
    });

    expect(() => lease.acquire()).toThrow("disk full");
    expect(lease.status()).toEqual({
      state: "idle",
      ownerId: null,
      acquiredAt: null,
      heartbeatAt: null,
    });
    expect(existsSync(join(directory, ".steam-bee-instance"))).toBe(false);

    const replacement = new InstanceLease(directory, () => 2_000);
    expect(replacement.acquire()).toMatchObject({ state: "held" });
    replacement.release();
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

    restore.release();
    expect(runtime.acquire()).toMatchObject({ state: "held" });
    runtime.release();
  });
});

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "steam-bee-lease-test-"));
  directories.push(directory);
  return directory;
}
