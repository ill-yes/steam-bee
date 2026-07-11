import { MAX_STEAM_APP_ID } from "@steam-bee/contracts";
import type { SteamApp } from "../../api";
import type { LibraryFilterMode } from "../../lib/status";
import type { LibraryRow } from "./types";

export function buildLibraryRows({
  apps,
  filter,
  mode,
  draftAppIds,
  gameLimit,
}: {
  apps: SteamApp[];
  filter: string;
  mode: LibraryFilterMode;
  draftAppIds: number[];
  gameLimit: number;
}): LibraryRow[] {
  const query = filter.trim().toLowerCase();
  const selectedAppIds = new Set(draftAppIds);

  return apps
    .filter((app) => {
      if (
        query &&
        !app.name.toLowerCase().includes(query) &&
        !String(app.appId).includes(query)
      ) {
        return false;
      }

      if (app.hidden && mode !== "hidden") return false;
      if (mode === "selected") return selectedAppIds.has(app.appId);
      if (mode === "unselected") return !selectedAppIds.has(app.appId);
      if (mode === "played") {
        return Boolean(app.playtimeForever && app.playtimeForever > 0);
      }
      if (mode === "unplayed") return !app.playtimeForever;
      if (mode === "favorites") return Boolean(app.favorite);
      if (mode === "hidden") return Boolean(app.hidden);
      return true;
    })
    .map((app) => {
      const selected = selectedAppIds.has(app.appId);
      return {
        ...app,
        selected,
        blockedByLimit: !selected && draftAppIds.length >= gameLimit,
      };
    });
}

export function nextDraftAppIds(
  current: number[],
  appId: number,
  gameLimit: number,
) {
  if (current.includes(appId)) {
    return current.filter((id) => id !== appId);
  }
  if (current.length >= gameLimit) return null;
  return [...current, appId];
}

export function appendManualAppId(
  current: number[],
  input: string,
  gameLimit: number,
) {
  const appId = Number(input);
  if (
    !Number.isInteger(appId) ||
    appId <= 0 ||
    appId > MAX_STEAM_APP_ID ||
    current.includes(appId) ||
    current.length >= gameLimit
  ) {
    return null;
  }
  return [...current, appId];
}
