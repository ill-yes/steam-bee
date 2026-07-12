import { describe, expect, it, vi } from "vitest";
import { AutoLibraryImporter } from "../src/steam/auto-library-importer.js";

function createImporter(
  overrides: Partial<ConstructorParameters<typeof AutoLibraryImporter>[0]> = {},
) {
  const dependencies = {
    hasLibrary: vi.fn().mockResolvedValue(false),
    importLibrary: vi.fn().mockResolvedValue([{ appId: 10 }, { appId: 20 }]),
    metadataFor: vi.fn().mockReturnValue({ correlationId: "operation-1" }),
    recordInfo: vi.fn().mockResolvedValue(undefined),
    recordError: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { importer: new AutoLibraryImporter(dependencies), dependencies };
}

describe("AutoLibraryImporter", () => {
  it("imports an empty library once and records its lifecycle", async () => {
    const { importer, dependencies } = createImporter();

    await importer.import("account-1");
    await importer.import("account-1");

    expect(dependencies.hasLibrary).toHaveBeenCalledTimes(1);
    expect(dependencies.importLibrary).toHaveBeenCalledTimes(1);
    expect(dependencies.recordInfo).toHaveBeenNthCalledWith(
      1,
      "account-1",
      "steam.library.import.start",
      "Automatic library import started.",
      { correlationId: "operation-1", mode: "auto" },
    );
    expect(dependencies.recordInfo).toHaveBeenNthCalledWith(
      2,
      "account-1",
      "steam.library.import",
      "2 games imported.",
      { correlationId: "operation-1", mode: "auto", appCount: 2 },
    );
  });

  it("marks an existing library complete without importing it", async () => {
    const { importer, dependencies } = createImporter({
      hasLibrary: vi.fn().mockResolvedValue(true),
    });

    await importer.import("account-1");
    await importer.import("account-1");

    expect(dependencies.hasLibrary).toHaveBeenCalledTimes(1);
    expect(dependencies.importLibrary).not.toHaveBeenCalled();
    expect(dependencies.recordInfo).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent import requests", async () => {
    let finishImport: (apps: readonly unknown[]) => void = () => {};
    const importLibrary = vi.fn(
      () =>
        new Promise<readonly unknown[]>((resolve) => {
          finishImport = resolve;
        }),
    );
    const { importer, dependencies } = createImporter({ importLibrary });

    const first = importer.import("account-1");
    await vi.waitFor(() => expect(importLibrary).toHaveBeenCalledTimes(1));
    const duplicate = importer.import("account-1");
    finishImport([]);
    await Promise.all([first, duplicate]);

    expect(dependencies.hasLibrary).toHaveBeenCalledTimes(1);
    expect(importLibrary).toHaveBeenCalledTimes(1);
  });

  it("records failures and permits a later retry", async () => {
    const importLibrary = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce([]);
    const { importer, dependencies } = createImporter({ importLibrary });

    await importer.import("account-1");
    await importer.import("account-1");

    expect(importLibrary).toHaveBeenCalledTimes(2);
    expect(dependencies.recordError).toHaveBeenCalledWith(
      "account-1",
      "steam.library.import.error",
      "Library import failed: temporary failure",
      { correlationId: "operation-1", mode: "auto" },
    );
  });

  it("can clear completed state when an account is forgotten", async () => {
    const { importer, dependencies } = createImporter();

    await importer.import("account-1");
    importer.clearAccount("account-1");
    await importer.import("account-1");

    expect(dependencies.importLibrary).toHaveBeenCalledTimes(2);
  });
});
