export const accountStatuses = [
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

export type AccountStatus = (typeof accountStatuses)[number];

export const personaStates = {
  online: 1,
  busy: 2,
  away: 3,
  invisible: 7,
} as const;

export type PersonaState = (typeof personaStates)[keyof typeof personaStates];

export type OwnedApp = {
  appId: number;
  name: string;
  playtimeForever: number;
};
