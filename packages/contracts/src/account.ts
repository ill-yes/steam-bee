export const ACCOUNT_STATUSES = [
  "disconnected",
  "connecting",
  "online",
  "boosting",
  "paused_manual",
  "paused_other_session",
  "login_required",
  "reconnecting",
  "error",
] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export function isAccountStatus(value: unknown): value is AccountStatus {
  return ACCOUNT_STATUSES.includes(value as AccountStatus);
}

export const DESIRED_STATES = ["stopped", "running", "paused"] as const;
export type DesiredState = (typeof DESIRED_STATES)[number];

export function isDesiredState(value: unknown): value is DesiredState {
  return DESIRED_STATES.includes(value as DesiredState);
}

export const PERSONA_STATES = {
  offline: 0,
  online: 1,
  busy: 2,
  away: 3,
  snooze: 4,
  lookingToTrade: 5,
  lookingToPlay: 6,
  invisible: 7,
} as const;
export const PERSONA_STATE_VALUES = [0, 1, 2, 3, 4, 5, 6, 7] as const;
export const SELECTABLE_PERSONA_STATE_VALUES = [1, 2, 3, 7] as const;
export type PersonaState = (typeof PERSONA_STATE_VALUES)[number];
export type SelectablePersonaState =
  (typeof SELECTABLE_PERSONA_STATE_VALUES)[number];

export function isPersonaState(value: unknown): value is PersonaState {
  return PERSONA_STATE_VALUES.includes(value as PersonaState);
}

export const MAX_STEAM_APP_ID = 2_147_483_647;
export const MAX_GAMES = 32;
export const MAX_GAMES_WITH_CUSTOM_TITLE = 31;

export function gameSelectionLimit(customTitle?: string | null) {
  return customTitle?.trim() ? MAX_GAMES_WITH_CUSTOM_TITLE : MAX_GAMES;
}

export type AccountCommand = "start" | "pause" | "resume" | "stop";

export type AccountStatusCapability = {
  active: boolean;
  paused: boolean;
  busy: boolean;
  importable: boolean;
  attention: boolean;
  canPause: boolean;
  canStop: boolean;
  adminCommand: Exclude<AccountCommand, "stop"> | null;
};

export const ACCOUNT_STATUS_CAPABILITIES = {
  disconnected: {
    active: false,
    paused: false,
    busy: false,
    importable: false,
    attention: false,
    canPause: false,
    canStop: false,
    adminCommand: "start",
  },
  connecting: {
    active: false,
    paused: false,
    busy: true,
    importable: false,
    attention: false,
    canPause: false,
    canStop: false,
    adminCommand: null,
  },
  online: {
    active: true,
    paused: false,
    busy: false,
    importable: true,
    attention: false,
    canPause: true,
    canStop: true,
    adminCommand: "pause",
  },
  boosting: {
    active: true,
    paused: false,
    busy: false,
    importable: true,
    attention: false,
    canPause: true,
    canStop: true,
    adminCommand: "pause",
  },
  paused_manual: {
    active: false,
    paused: true,
    busy: false,
    importable: false,
    attention: false,
    canPause: false,
    canStop: true,
    adminCommand: "resume",
  },
  paused_other_session: {
    active: false,
    paused: true,
    busy: false,
    importable: false,
    attention: false,
    canPause: false,
    canStop: true,
    adminCommand: "resume",
  },
  login_required: {
    active: false,
    paused: false,
    busy: false,
    importable: false,
    attention: true,
    canPause: false,
    canStop: true,
    adminCommand: "start",
  },
  reconnecting: {
    active: false,
    paused: false,
    busy: true,
    importable: false,
    attention: false,
    canPause: false,
    canStop: false,
    adminCommand: null,
  },
  error: {
    active: false,
    paused: false,
    busy: false,
    importable: false,
    attention: true,
    canPause: false,
    canStop: true,
    adminCommand: "start",
  },
} as const satisfies Record<AccountStatus, AccountStatusCapability>;

export type AccountGame = {
  appId: number;
  enabled: boolean;
  source: string;
};

export type SteamAccountBase = {
  id: string;
  accountName: string;
  steamId: string | null;
  status: AccountStatus;
  runtimeStatus: AccountStatus;
  desiredState: DesiredState;
  personaState: PersonaState;
  customTitle: string | null;
  activePresetId: string | null;
  tokenExpiresAt: number | null;
  lastError: string | null;
  latestBoostStartedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type Account = SteamAccountBase & {
  games: AccountGame[];
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

export type SteamProfile = {
  steamId: string | null;
  displayName: string | null;
  profileUrl: string | null;
  avatarUrl: string | null;
};
