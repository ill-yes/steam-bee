import { useMemo } from "react";
import type { SteamApp } from "../../api";
import type { LibraryFilterMode } from "../../lib/status";
import { buildLibraryRows } from "./library-model";

export function useLibraryRows({
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
}) {
  return useMemo(
    () => buildLibraryRows({ apps, filter, mode, draftAppIds, gameLimit }),
    [apps, draftAppIds, filter, gameLimit, mode],
  );
}
