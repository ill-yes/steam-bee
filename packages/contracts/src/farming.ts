export type FarmingPhase =
  | "stopped"
  | "scanning"
  | "warming"
  | "farming"
  | "completed"
  | "blocked"
  | "error";

export type FarmingConfig = {
  maxConcurrentGames: number;
  skipRefundable: boolean;
  whitelist: number[];
  blacklist: number[];
  /** Restart farming after a SteamBee restart or a brief Steam disconnect. */
  autoResume: boolean;
};

export type FarmingSkipReason =
  "blacklisted" | "not_whitelisted" | "refund_window" | "purchase_date_unknown";

export type FarmingGame = {
  appId: number;
  name: string;
  remainingDrops: number;
  playtimeMinutes: number | null;
  acquiredAt: number | null;
  skipReason: FarmingSkipReason | null;
};

export type FarmingSnapshot = {
  accountId: string;
  phase: FarmingPhase;
  config: FarmingConfig;
  games: FarmingGame[];
  activeAppIds: number[];
  remainingDrops: number;
  scannedAt: number | null;
  startedAt: number | null;
  truncated: boolean;
  reason: string | null;
  canStart: boolean;
  gameLimit: number;
};

export const DEFAULT_FARMING_CONFIG: FarmingConfig = {
  maxConcurrentGames: 32,
  skipRefundable: true,
  whitelist: [],
  blacklist: [],
  autoResume: true,
};
