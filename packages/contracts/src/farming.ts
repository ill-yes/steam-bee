export type FarmingPhase =
  | "stopped"
  | "scanning"
  | "warming"
  | "farming"
  | "completed"
  | "blocked"
  | "error";

export const FARMING_ORDERS = [
  "default",
  "card_value",
  "drops_desc",
  "drops_asc",
  "hours_desc",
  "acquired_asc",
  "name",
] as const;
/** How games without a manual priority are ordered after the pinned ones. */
export type FarmingOrder = (typeof FARMING_ORDERS)[number];

export type FarmingConfig = {
  maxConcurrentGames: number;
  skipRefundable: boolean;
  whitelist: number[];
  blacklist: number[];
  /** Restart farming after a SteamBee restart or a brief Steam disconnect. */
  autoResume: boolean;
  order: FarmingOrder;
  /** Games pulled to the front, farmed one at a time in this order. */
  priority: number[];
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
  /** Average market price of one normal card; null while unknown. */
  cardValue?: { average: number; text: string } | null;
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
  /** True while card prices are looked up for the card value order. */
  pricing?: boolean;
};

export const DEFAULT_FARMING_CONFIG: FarmingConfig = {
  maxConcurrentGames: 32,
  skipRefundable: true,
  whitelist: [],
  blacklist: [],
  autoResume: true,
  order: "default",
  priority: [],
};
