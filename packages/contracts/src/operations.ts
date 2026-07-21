export const RECOVERY_ACTIONS = [
  "none",
  "wait",
  "retry",
  "reauthenticate",
  "manual_resume",
] as const;
export type RecoveryAction = (typeof RECOVERY_ACTIONS)[number];

export const STEAM_ERROR_CLASSES = [
  "none",
  "transient",
  "rate_limited",
  "authentication",
  "session_replaced",
  "terminal",
  "unknown",
] as const;
export type SteamErrorClass = (typeof STEAM_ERROR_CLASSES)[number];

export type AccountHealth = {
  lastSteamContactAt: number | null;
  nextRetryAt: number | null;
  retryAttempt: number;
  errorClass: SteamErrorClass;
  errorCode: number | null;
  recoveryAction: RecoveryAction;
  libraryImportedAt: number | null;
};

export const RESUME_POLICIES = ["automatic", "delayed", "manual"] as const;
export type ResumePolicy = (typeof RESUME_POLICIES)[number];

export const SAFETY_HOLD_REASONS = [
  "manual",
  "pause_until",
  "session_limit",
  "daily_limit",
  "weekly_limit",
  "other_session_delay",
  "other_session_manual",
] as const;
export type SafetyHoldReason = (typeof SAFETY_HOLD_REASONS)[number];

export type AccountSafetyPolicy = {
  accountId: string;
  resumePolicy: ResumePolicy;
  resumeDelayMinutes: number;
  maxSessionMinutes: number | null;
  maxDailyMinutes: number | null;
  maxWeeklyMinutes: number | null;
  pauseUntil: number | null;
  holdReason: SafetyHoldReason | null;
  holdCreatedAt: number | null;
  updatedAt: number;
};

export type AccountGroup = {
  id: string;
  name: string;
  accountIds: string[];
  createdAt: number;
  updatedAt: number;
};

export type BulkAccountCommand = "pause" | "stop";
export type BulkAccountCommandResult = {
  groupId: string;
  command: BulkAccountCommand;
  results: Array<{
    accountId: string;
    ok: boolean;
    error: string | null;
  }>;
};

export type SchedulePreviewItem = {
  windowId: string;
  scheduleId: string;
  scheduleName: string;
  presetId: string;
  presetName: string | null;
  startsAt: number;
  endsAt: number;
  skipped: boolean;
  /** Whether this window wins at its start instant; later overlaps may supersede it. */
  winner: boolean;
  conflictScheduleIds: string[];
};

export type SchedulePreview = {
  generatedAt: number;
  through: number;
  timezoneCount: number;
  items: SchedulePreviewItem[];
};

export type PlaytimeGoal = {
  id: string;
  accountId: string;
  appId: number;
  appName: string;
  targetMinutes: number;
  currentMinutes: number;
  progressPercent: number;
  snapshotImportedAt: number | null;
  reached: boolean;
  createdAt: number;
  updatedAt: number;
};

export const NOTIFICATION_TARGETS = ["browser", "webhook"] as const;
export type NotificationTarget = (typeof NOTIFICATION_TARGETS)[number];
export const NOTIFICATION_EFFECTIVE_STATUSES = [
  "disabled",
  "active",
  "retrying",
  "failed",
  "suspended",
] as const;
export type NotificationEffectiveStatus =
  (typeof NOTIFICATION_EFFECTIVE_STATUSES)[number];

export type NotificationRule = {
  id: string;
  name: string;
  target: NotificationTarget;
  enabled: boolean;
  effectiveEnabled: boolean;
  effectiveStatus: NotificationEffectiveStatus;
  failureCount: number;
  suspendedUntil: number | null;
  nextRetryAt: number | null;
  eventTypes: string[];
  webhookConfigured: boolean;
  createdAt: number;
  updatedAt: number;
};

export type InstanceLeaseStatus = {
  state: "idle" | "held" | "contended";
  ownerId: string | null;
  acquiredAt: number | null;
  heartbeatAt: number | null;
};

export type BackupManifest = {
  formatVersion: 1;
  createdAt: number;
  migrationId: string | null;
  entries: Array<{ path: string; size: number; sha256: string }>;
};
