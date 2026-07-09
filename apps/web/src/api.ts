import type {
  ApiErrorResponse,
  BuildMetadata,
  MeResponse,
} from "@steam-bee/contracts";
import type { Messages } from "./i18n";

export type Me = MeResponse;

export type Account = {
  id: string;
  accountName: string;
  steamId: string | null;
  status: string;
  runtimeStatus: string;
  desiredState: string;
  personaState: number;
  customTitle: string | null;
  activePresetId: string | null;
  tokenExpiresAt: number | null;
  lastError: string | null;
  latestBoostStartedAt: number | null;
  createdAt: number;
  updatedAt: number;
  games: Array<{ appId: number; enabled: boolean; source: string }>;
};

export type SteamApp = {
  appId: number;
  name: string;
  playtimeForever?: number;
  source?: string;
  favorite?: boolean;
  hidden?: boolean;
  tags?: string[];
};

export type SteamEvent = {
  id: number;
  accountId: string | null;
  level: "info" | "warn" | "error";
  type: string;
  message: string;
  metadataJson?: string | null;
  createdAt: number;
};

export type Diagnostics = {
  build: BuildMetadata;
  logging: {
    level: string;
    requests: boolean;
    quietRequests: boolean;
  };
  runtime: {
    dataDir: string;
    publicDir: string;
    sseClients: number;
  };
  migrations: {
    current: string | null;
    latest: string | null;
    pending: Array<{ id: string; description: string }>;
  };
  events: {
    sampleSize: number;
    lastEventAt: number | null;
    byLevel: Record<string, number>;
    byCategory: Record<string, number>;
  };
  accounts: {
    total: number;
    desiredRunning: number;
  };
};

export type SystemStatus = {
  code: string;
  label: string;
  tone: "good" | "danger" | "warn" | "info" | "neutral";
  detail: string;
  pendingMigrations: number;
  accountErrors: number;
  recentErrors: number;
  checkedAt: number;
};

export type BoostPreset = {
  id: string;
  accountId: string;
  name: string;
  personaState: number;
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
  openSession: unknown | null;
  topGames: Array<{ appId: number; name: string; durationMs: number }>;
  recentSessions: Array<{
    id: string;
    presetId: string | null;
    presetName: string | null;
    appIds: number[];
    apps: Array<{ appId: number; name: string }>;
    startedAt: number;
    endedAt: number | null;
    stopReason: string | null;
    durationMs: number;
  }>;
};

export type SteamProfile = {
  steamId: string | null;
  displayName: string | null;
  profileUrl: string | null;
  avatarUrl: string | null;
};

export type AdminSession = {
  id: string;
  current: boolean;
  expiresAt: number;
  createdAt: number;
  lastSeenAt: number;
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
  accounts: Array<
    Account & {
      selectedGameCount: number;
      libraryAppCount: number;
      presetCount: number;
      scheduleCount: number;
      eventCount: number;
    }
  >;
  events: SteamEvent[];
  presets: Array<{
    id: string;
    accountId: string;
    accountName: string | null;
    name: string;
    personaState: number;
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

let csrfToken: string | null = null;
export const authExpiredEvent = "steam-bee:auth-expired";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (
    csrfToken &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(init.method ?? "GET")
  ) {
    headers.set("x-csrf-token", csrfToken);
  }

  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers,
  });

  const text = await response.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      if (!response.ok) {
        throw new ApiError(
          "The server returned an invalid response.",
          "INVALID_RESPONSE",
          response.status,
        );
      }
      throw new ApiError(
        "The server returned an invalid response.",
        "INVALID_RESPONSE",
        502,
      );
    }
  }
  if (!response.ok) {
    const payload = isApiErrorResponse(data) ? data : null;
    if (response.status === 401 && path !== "/api/login") {
      window.dispatchEvent(new CustomEvent(authExpiredEvent));
    }
    throw new ApiError(
      payload?.error ?? "Request failed.",
      payload?.code ?? `HTTP_${response.status}`,
      response.status,
    );
  }

  return data as T;
}

export function apiErrorMessage(error: unknown, messages: Messages) {
  if (error instanceof ApiError) {
    const localized = messages.errors[error.code as keyof Messages["errors"]];
    return localized ?? error.message;
  }
  return error instanceof Error ? error.message : messages.admin.actionFailed;
}

export function isAbortError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string" &&
    "code" in value &&
    typeof value.code === "string"
  );
}
