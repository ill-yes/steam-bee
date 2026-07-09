import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NODE_ENV = "test";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "steam-bee-test-"));
process.env.HOST = "127.0.0.1";
process.env.PORT = "3000";
process.env.SETUP_TOKEN = "steam-bee-test-setup-token";
