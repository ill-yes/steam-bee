import { createLogger } from "../util/logger.js";
import { safeErrorMessage } from "../util/redact.js";

type RecordEvent = (
  accountId: string,
  type: string,
  message: string,
  metadata?: Record<string, unknown>,
) => Promise<void>;

type AutoLibraryImporterDependencies = {
  hasLibrary: (accountId: string) => boolean | Promise<boolean>;
  importLibrary: (accountId: string) => Promise<readonly unknown[]>;
  metadataFor: (accountId: string) => Record<string, unknown>;
  recordInfo: RecordEvent;
  recordError: RecordEvent;
};

export class AutoLibraryImporter {
  private readonly completed = new Set<string>();
  private readonly inFlight = new Set<string>();
  private readonly logger = createLogger("steam-auto-library-import");

  constructor(private readonly dependencies: AutoLibraryImporterDependencies) {}

  async import(accountId: string) {
    if (this.completed.has(accountId) || this.inFlight.has(accountId)) return;

    this.inFlight.add(accountId);
    try {
      if (await this.dependencies.hasLibrary(accountId)) {
        this.completed.add(accountId);
        this.logger.debug(
          { accountId },
          "Skipping auto-import because library already exists",
        );
        return;
      }

      await this.dependencies.recordInfo(
        accountId,
        "steam.library.import.start",
        "Automatic library import started.",
        this.metadata(accountId),
      );

      const apps = await this.dependencies.importLibrary(accountId);
      this.completed.add(accountId);
      await this.dependencies.recordInfo(
        accountId,
        "steam.library.import",
        `${apps.length} games imported.`,
        { ...this.metadata(accountId), appCount: apps.length },
      );
    } catch (error) {
      await this.dependencies.recordError(
        accountId,
        "steam.library.import.error",
        `Library import failed: ${safeErrorMessage(error)}`,
        this.metadata(accountId),
      );
    } finally {
      this.inFlight.delete(accountId);
    }
  }

  clearAccount(accountId: string) {
    this.completed.delete(accountId);
    this.inFlight.delete(accountId);
  }

  clearAll() {
    this.completed.clear();
    this.inFlight.clear();
  }

  private metadata(accountId: string) {
    return { ...this.dependencies.metadataFor(accountId), mode: "auto" };
  }
}
