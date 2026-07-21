import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paths } from "../config.js";
import { getMigrationState, sqlite } from "../db/client.js";
import { encryptBackup } from "./format.js";

export async function createEncryptedBackup(passphrase: string) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "steam-bee-backup-"));
  const snapshotPath = join(temporaryDirectory, "steam-bee.sqlite");
  try {
    await sqlite.backup(snapshotPath);
    return encryptBackup(
      [
        { path: "steam-bee.sqlite", data: readFileSync(snapshotPath) },
        { path: "instance.secret", data: readFileSync(paths.secret) },
      ],
      passphrase,
      getMigrationState().current,
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
