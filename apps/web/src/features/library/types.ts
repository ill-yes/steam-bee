import type { ReactNode, RefObject } from "react";
import type { AccountStatus } from "@steam-bee/contracts";
import type { SteamApp } from "../../api";

export type SelectedGame = {
  appId: number;
  name: string;
  playtimeForever?: number;
};

export type SelectionStateCopy = {
  label: string;
  body: string;
  tone: "busy" | "applied" | "queued" | "idle" | "dirty";
};

export type LibraryRow = SteamApp & {
  selected: boolean;
  blockedByLimit: boolean;
};

export type LibraryUpdatePatch = {
  favorite?: boolean;
  hidden?: boolean;
};

export type LibraryModel = {
  apps: SteamApp[];
  loading: boolean;
  error: string | null;
  canImport: boolean;
  onImport: () => Promise<void>;
  onUpdateMeta: (appId: number, patch: LibraryUpdatePatch) => Promise<void>;
};

export type SelectionModel = {
  draftAppIds: number[];
  appliedAppIds: number[];
  selectedGames: SelectedGame[];
  gameLimit: number;
  overLimit: boolean;
  applying: boolean;
  appliedAt: number | null;
  dirty: boolean;
  state: SelectionStateCopy;
  manualAppInputRef: RefObject<HTMLInputElement | null>;
  onChange: (appIds: number[]) => void;
  onApply: () => Promise<void>;
  onRevert: () => void;
};

export type GameLibraryPanelProps = {
  account: { id: string; runtimeStatus: AccountStatus };
  library: LibraryModel;
  selection: SelectionModel;
  rightRailExtra?: ReactNode;
};
