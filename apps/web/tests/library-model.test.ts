import { describe, expect, it } from "vitest";
import { MAX_STEAM_APP_ID } from "@steam-bee/contracts";
import type { SteamApp } from "../src/api";
import {
  appendManualAppId,
  buildLibraryRows,
  nextDraftAppIds,
} from "../src/features/library/library-model";

describe("library row model", () => {
  it("filters by search, selection, metadata and hidden state", () => {
    expect(rows({ filter: "counter" }).map((app) => app.appId)).toEqual([730]);
    expect(rows({ filter: "440" }).map((app) => app.appId)).toEqual([440]);
    expect(rows({ mode: "selected" }).map((app) => app.appId)).toEqual([730]);
    expect(rows({ mode: "unselected" }).map((app) => app.appId)).toEqual([440]);
    expect(rows({ mode: "favorites" }).map((app) => app.appId)).toEqual([730]);
    expect(rows({ mode: "hidden" }).map((app) => app.appId)).toEqual([10]);
  });

  it("marks only unselected rows as blocked at the game limit", () => {
    const result = rows({ gameLimit: 1 });
    expect(result.find((app) => app.appId === 730)).toMatchObject({
      selected: true,
      blockedByLimit: false,
    });
    expect(result.find((app) => app.appId === 440)).toMatchObject({
      selected: false,
      blockedByLimit: true,
    });
  });

  it("allows removal at the limit but prevents another selection", () => {
    expect(nextDraftAppIds([730], 730, 1)).toEqual([]);
    expect(nextDraftAppIds([730], 440, 1)).toBeNull();
    expect(nextDraftAppIds([730], 440, 2)).toEqual([730, 440]);
  });

  it("accepts only unique positive integer AppIDs within the Steam range", () => {
    expect(appendManualAppId([730], "440", 2)).toEqual([730, 440]);
    expect(appendManualAppId([730], "730", 2)).toBeNull();
    expect(appendManualAppId([730], "1.5", 2)).toBeNull();
    expect(appendManualAppId([730], "0", 2)).toBeNull();
    expect(
      appendManualAppId([730], String(MAX_STEAM_APP_ID + 1), 2),
    ).toBeNull();
    expect(appendManualAppId([730], "440", 1)).toBeNull();
  });
});

function rows({
  filter = "",
  mode = "all",
  gameLimit = 32,
}: {
  filter?: string;
  mode?: Parameters<typeof buildLibraryRows>[0]["mode"];
  gameLimit?: number;
} = {}) {
  return buildLibraryRows({
    apps,
    filter,
    mode,
    draftAppIds: [730],
    gameLimit,
  });
}

const apps: SteamApp[] = [
  {
    appId: 730,
    name: "Counter-Strike 2",
    playtimeForever: 120,
    source: "library",
    favorite: true,
    hidden: false,
    tags: [],
  },
  {
    appId: 440,
    name: "Team Fortress 2",
    playtimeForever: 0,
    source: "library",
    favorite: false,
    hidden: false,
    tags: [],
  },
  {
    appId: 10,
    name: "Hidden Game",
    playtimeForever: 10,
    source: "library",
    favorite: false,
    hidden: true,
    tags: [],
  },
];
