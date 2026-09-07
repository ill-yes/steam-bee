import { chmodSync, renameSync, writeSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { InstanceLease } from "../../src/instance-lease.js";
import { restoreBackup } from "../../src/restore.js";

const [mode, dataDir, inputPath] = process.argv.slice(2);
if (!dataDir) throw new Error("Missing isolated test directory");
const report = (message: string) => writeSync(1, `${message}\n`);
const stop = () => {
  report("paused");
  process.kill(process.pid, "SIGSTOP");
};

if (mode === "initialization-crash" || mode === "publication-crash") {
  const original = Database.prototype.exec;
  Database.prototype.exec = function (sql: string) {
    if (mode === "publication-crash" && sql === "COMMIT") stop();
    const result = original.call(this, sql);
    if (
      mode === "initialization-crash" &&
      sql.startsWith("CREATE TABLE instance_guard")
    )
      stop();
    return result;
  };
}

if (mode === "restore-install-crash" || mode === "restore-rollback-crash") {
  if (!inputPath) throw new Error("Missing backup input");
  restoreBackup({
    dataDir,
    inputPath,
    passphrase: "correct horse battery staple",
    fileOperations: {
      rename: ((source: string, destination: string) => {
        if (
          mode === "restore-rollback-crash" &&
          source ===
            join(dataDir, ".steam-bee-restore-staging", "instance.secret")
        ) {
          throw new Error("Injected second-file installation failure");
        }
        renameSync(source, destination);
        if (
          mode === "restore-install-crash" &&
          source === join(dataDir, "steam-bee.sqlite")
        )
          stop();
        if (
          mode === "restore-rollback-crash" &&
          source ===
            join(dataDir, ".steam-bee-restore-rollback", "instance.secret")
        ) {
          report("rollback-original-restored");
          stop();
        }
      }) as typeof renameSync,
    },
  });
} else {
  const lease = new InstanceLease(dataDir, Date.now, {
    ownerKind: mode === "restore" ? "restore" : "runtime",
  });
  try {
    lease.acquire();
    report("held");
  } catch (error) {
    report(error instanceof Error ? error.message : "blocked");
    process.exit(2);
  }
  if (mode === "try") {
    lease.release();
    process.exit(0);
  }
  process.on("message", (message) => {
    if (message === "release") {
      lease.release();
      process.exit(0);
    }
    if (message === "fault") {
      lease.onLost(() => report("lost"));
      chmodSync(join(dataDir, ".steam-bee-instance"), 0o644);
      (lease as unknown as { heartbeat(): void }).heartbeat();
      report("unsafe continuation");
    }
  });
  setInterval(() => {}, 1_000);
}
