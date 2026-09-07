import { spawn, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { InstanceLease } from "../src/instance-lease.js";
import Database from "better-sqlite3";
import { encryptBackup } from "../src/backup/format.js";

const fixture = fileURLToPath(
  new URL("./fixtures/instance-guard-process.ts", import.meta.url),
);
const directories: string[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited(child);
    }
  }
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("instance guard process boundary", () => {
  it("retains exclusivity after COMMIT, same-process contention, and SIGSTOP; recovers after SIGKILL", async () => {
    const directory = temporaryDirectory();
    const owner = launch("runtime", directory);
    await output(owner, "held");
    const inode = lstatSync(join(directory, ".steam-bee-instance")).ino;
    const contender = new InstanceLease(directory);
    expect(() => contender.acquire()).toThrow(/guard/i);
    expect(await exited(launch("try", directory))).toBe(2);
    owner.kill("SIGSTOP");
    expect(await exited(launch("try", directory))).toBe(2);
    owner.kill("SIGKILL");
    await exited(owner);
    expect(await exited(launch("try", directory))).toBe(0);
    expect(lstatSync(join(directory, ".steam-bee-instance")).ino).toBe(inode);
  });

  it("a rejected same-process owner cannot drop the real owner's OS lock", async () => {
    const directory = temporaryDirectory();
    const owner = new InstanceLease(directory);
    owner.acquire();
    try {
      expect(() => new InstanceLease(directory).acquire()).toThrow(
        /held in this process/,
      );
      expect(await exited(launch("try", directory))).toBe(2);
    } finally {
      owner.release();
    }
    expect(await exited(launch("try", directory))).toBe(0);
  });

  it.each(["initialization-crash", "publication-crash"])(
    "recovers atomic %s without guard replacement",
    async (mode) => {
      const directory = temporaryDirectory();
      const owner = launch(mode, directory);
      await output(owner, "paused");
      const inode = lstatSync(join(directory, ".steam-bee-instance")).ino;
      expect(await exited(launch("try", directory))).toBe(2);
      owner.kill("SIGKILL");
      await exited(owner);
      expect(await exited(launch("try", directory))).toBe(0);
      expect(lstatSync(join(directory, ".steam-bee-instance")).ino).toBe(inode);
    },
  );

  it("retains an acquired restore fence after SIGKILL", async () => {
    const directory = temporaryDirectory();
    const owner = launch("restore", directory);
    await output(owner, "held");
    owner.kill("SIGKILL");
    await exited(owner);
    const runtime = launch("try", directory);
    await output(runtime, "restore_required");
    expect(await exited(runtime)).toBe(2);
    const restore = launch("restore", directory);
    await output(restore, "restore_required");
    expect(await exited(restore)).toBe(2);
  });

  it.each(["restore-install-crash", "restore-rollback-crash"])(
    "retains all recovery material and blocks both owners after SIGKILL during %s",
    async (crashMode) => {
      const directory = temporaryDirectory();
      const snapshotPath = join(directory, "snapshot.sqlite");
      const snapshot = new Database(snapshotPath);
      snapshot.exec(
        "CREATE TABLE app_migration (id TEXT); INSERT INTO app_migration VALUES ('001_initial_schema')",
      );
      snapshot.close();
      const original = Buffer.from("original database placeholder");
      const originalSecret = Buffer.from(
        Buffer.alloc(32, 3).toString("base64"),
      );
      const replacement = readFileSync(snapshotPath);
      const replacementSecret = Buffer.from(
        Buffer.alloc(32, 9).toString("base64"),
      );
      writeFileSync(join(directory, "steam-bee.sqlite"), original);
      writeFileSync(join(directory, "instance.secret"), originalSecret);
      const inputPath = join(directory, "backup.sbb");
      writeFileSync(
        inputPath,
        encryptBackup(
          [
            { path: "steam-bee.sqlite", data: replacement },
            {
              path: "instance.secret",
              data: replacementSecret,
            },
          ],
          "correct horse battery staple",
          "001_initial_schema",
        ),
      );
      const owner = launch(crashMode, directory, inputPath);
      await output(owner, "paused");
      if (crashMode === "restore-rollback-crash") {
        expect(logs.get(owner)).toContain("rollback-original-restored");
      }
      owner.kill("SIGKILL");
      await exited(owner);
      expect(owner.signalCode).toBe("SIGKILL");
      expect(
        readFileSync(
          join(directory, ".steam-bee-restore-rollback", "steam-bee.sqlite"),
        ),
      ).toEqual(original);
      expect(
        readFileSync(
          join(directory, ".steam-bee-restore-staging", "instance.secret"),
        ),
      ).toEqual(replacementSecret);
      expect(
        readFileSync(
          join(directory, ".steam-bee-restore-staging", "steam-bee.sqlite"),
        ),
      ).toEqual(replacement);
      expect(readFileSync(join(directory, "instance.secret"))).toEqual(
        originalSecret,
      );
      expect(existsSync(join(directory, "steam-bee.sqlite"))).toBe(false);
      for (const mode of ["try", "restore"]) {
        const contender = launch(mode, directory);
        await output(contender, "restore_required");
        expect(await exited(contender)).toBe(2);
      }
    },
  );

  it("fails stop synchronously even when a lost-guard handler returns", async () => {
    const directory = temporaryDirectory();
    const owner = launch("runtime", directory);
    await output(owner, "held");
    const lost = output(owner, "lost");
    owner.send("fault");
    await lost;
    expect(await exited(owner)).toBe(1);
    expect(logs.get(owner)).not.toContain("unsafe continuation");
    chmodSync(join(directory, ".steam-bee-instance"), 0o600);
    expect(await exited(launch("try", directory))).toBe(0);
  });
});

const logs = new Map<ChildProcess, string>();
function launch(mode: string, directory: string, inputPath?: string) {
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      fixture,
      mode,
      directory,
      ...(inputPath ? [inputPath] : []),
    ],
    {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  children.push(child);
  logs.set(child, "");
  child.stdout!.on("data", (chunk: Buffer) =>
    logs.set(child, logs.get(child)! + chunk.toString()),
  );
  child.stderr!.on("data", (chunk: Buffer) =>
    logs.set(child, logs.get(child)! + chunk.toString()),
  );
  return child;
}

function output(child: ChildProcess, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => done(new Error(`Missing ${expected}: ${logs.get(child)}`)),
      5_000,
    );
    const check = () => {
      if (logs.get(child)?.includes(expected)) done();
    };
    const onExit = () => {
      if (logs.get(child)?.includes(expected)) done();
      else done(new Error(`Exited before ${expected}: ${logs.get(child)}`));
    };
    const done = (error?: Error) => {
      clearTimeout(timeout);
      child.stdout!.off("data", check);
      child.off("exit", onExit);
      if (error) reject(error);
      else resolve();
    };
    child.stdout!.on("data", check);
    child.on("exit", onExit);
    check();
  });
}

function exited(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve(child.exitCode);
  return new Promise((resolve) => child.once("exit", (code) => resolve(code)));
}

function temporaryDirectory() {
  const directory = mkdtempSync(
    join(tmpdir(), "steam-bee-instance-guard-process-"),
  );
  directories.push(directory);
  return directory;
}
