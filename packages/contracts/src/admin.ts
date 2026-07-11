import type { PersonaState, SteamAccountBase } from "./account.js";
import type { SteamEvent } from "./events.js";

export type AdminSession = {
  id: string;
  current: boolean;
  expiresAt: number;
  createdAt: number;
  lastSeenAt: number;
};

export type AdminAccountSummary = SteamAccountBase & {
  selectedGameCount: number;
  libraryAppCount: number;
  presetCount: number;
  scheduleCount: number;
  eventCount: number;
};

export type AdminOverview = {
  generatedAt: number;
  totals: {
    accounts: number;
    sessions: number;
    events: number;
    presets: number;
    schedules: number;
    appCache: number;
    libraryEntries: number;
    selectedGames: number;
  };
  sessions: AdminSession[];
  accounts: AdminAccountSummary[];
  events: SteamEvent[];
  presets: Array<{
    id: string;
    accountId: string;
    accountName: string | null;
    name: string;
    personaState: PersonaState;
    customTitle: string | null;
    appCount: number;
    createdAt: number;
    updatedAt: number;
  }>;
  schedules: Array<{
    id: string;
    accountId: string;
    accountName: string | null;
    presetId: string;
    presetName: string | null;
    name: string;
    enabled: boolean;
    weekdays: number[];
    startTime: string;
    endTime: string;
    timezone: string;
    createdAt: number;
    updatedAt: number;
  }>;
  apps: Array<{
    appId: number;
    name: string;
    playtimeForever: number;
    source: string;
    updatedAt: number;
    libraryAccountCount: number;
    selectedAccountCount: number;
    presetCount: number;
  }>;
};
