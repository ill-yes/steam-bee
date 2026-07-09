import { useEffect, useRef, useState } from "react";
import type { SortingState } from "@tanstack/react-table";
import type { LibraryFilterMode, LibrarySortMode } from "../../lib/status";

export function useGameLibraryController(
  accountId: string,
  draftAppIds: number[],
) {
  const [libraryFilter, setLibraryFilter] = useState("");
  const [libraryMode, setLibraryMode] = useState<LibraryFilterMode>("all");
  const [librarySort, setLibrarySort] = useState<LibrarySortMode>("name");
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [selectionCollapsed, setSelectionCollapsed] = useState(false);
  const [manualAppId, setManualAppId] = useState("");
  const draftAppIdsRef = useRef(draftAppIds);
  const [sorting, setSorting] = useState<SortingState>([
    { id: "name", desc: false },
  ]);

  useEffect(() => {
    draftAppIdsRef.current = draftAppIds;
  }, [draftAppIds]);
  useEffect(() => {
    setLibraryFilter("");
    setLibraryMode("all");
    setLibrarySort("name");
    setSorting([{ id: "name", desc: false }]);
  }, [accountId]);
  useEffect(() => {
    if (librarySort === "name") setSorting([{ id: "name", desc: false }]);
    if (librarySort === "playtime") {
      setSorting([{ id: "playtimeForever", desc: true }]);
    }
    if (librarySort === "appid") setSorting([{ id: "appId", desc: false }]);
  }, [librarySort]);

  return {
    libraryFilter,
    setLibraryFilter,
    libraryMode,
    setLibraryMode,
    librarySort,
    setLibrarySort,
    libraryCollapsed,
    setLibraryCollapsed,
    selectionCollapsed,
    setSelectionCollapsed,
    manualAppId,
    setManualAppId,
    draftAppIdsRef,
    sorting,
    setSorting,
  };
}
