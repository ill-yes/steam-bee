import type { PersonaState } from "./account.js";

export type BoostPreset = {
  id: string;
  accountId: string;
  name: string;
  personaState: PersonaState;
  customTitle: string | null;
  appIds: number[];
  games: Array<{ appId: number; name: string }>;
  createdAt: number;
  updatedAt: number;
};

export type BoostSchedule = {
  id: string;
  accountId: string;
  presetId: string;
  presetName: string | null;
  name: string;
  enabled: boolean;
  weekdays: number[];
  startTime: string;
  endTime: string;
  timezone: string;
  lastStartedWindow: string | null;
  lastStoppedWindow: string | null;
  createdAt: number;
  updatedAt: number;
};

export type BoostAnalytics = {
  todayMs: number;
  last7DaysMs: number;
  totalSessions: number;
  openSession: BoostSession | null;
  topGames: Array<{ appId: number; name: string; durationMs: number }>;
  recentSessions: BoostSession[];
};

export type BoostSession = {
  id: string;
  presetId: string | null;
  presetName: string | null;
  appIds: number[];
  apps: Array<{ appId: number; name: string }>;
  startedAt: number;
  endedAt: number | null;
  stopReason: string | null;
  durationMs: number;
};
