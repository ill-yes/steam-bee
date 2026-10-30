import {
  DEFAULT_FARMING_CONFIG,
  type FarmingConfig,
  type FarmingGame,
  type FarmingSnapshot,
} from "@steam-bee/contracts";

export type FarmingAvailability = {
  allowed: boolean;
  reason: string | null;
  gameLimit: number;
};
export type FarmingAdapter = {
  discover(
    accountId: string,
    shouldContinue?: () => boolean,
  ): Promise<{ games: FarmingGame[]; truncated: boolean }>;
  availability(accountId: string): Promise<FarmingAvailability>;
  begin?(accountId: string, shouldApply: () => boolean): Promise<void>;
  apply(
    accountId: string,
    appIds: number[],
    shouldApply: () => boolean,
  ): Promise<void>;
  end(accountId: string, shouldEnd?: () => boolean): Promise<void>;
  /** Persists whether farming should resume after an interruption. */
  remember?(accountId: string, resume: boolean): void;
  /**
   * Average card prices per game. Null marks a game that was looked up
   * without a price; games it did not reach are left out.
   */
  cardValues?(
    accountId: string,
    appIds: number[],
    shouldContinue: () => boolean,
  ): Promise<Map<number, CardValue | null>>;
};

type CardValue = { average: number; text: string };

const CARD_VALUE_TTL = 24 * 60 * 60_000;
/** Games without market listings are asked again less eagerly than daily. */
const MISSING_CARD_VALUE_TTL = 6 * 60 * 60_000;

/** Interruptions that do not mean the user wanted farming to end. */
const RESUMABLE_HALTS = new Set([
  "shutdown",
  "shutting_down",
  "connecting",
  "reconnecting",
  "disconnected",
  "error",
  "not_connected",
]);

type Session = {
  snapshot: FarmingSnapshot;
  generation: number;
  timer: ReturnType<typeof setTimeout> | null;
  activeSince: number | null;
  applied: boolean;
  /** Position of each game on Steam's badge pages, the default order. */
  badgeOrder: Map<number, number>;
  cardValues: Map<number, { value: CardValue | null; at: number }>;
};

export class FarmingController {
  private readonly sessions = new Map<string, Session>();
  private shuttingDown = false;

  constructor(
    private readonly adapter: FarmingAdapter,
    private readonly now = () => Date.now(),
    private readonly tickMs = 60_000,
    private readonly scanMs = 5 * 60_000,
  ) {}

  snapshot(accountId: string, config?: FarmingConfig): FarmingSnapshot {
    let session = this.sessions.get(accountId);
    if (!session) {
      session = {
        snapshot: {
          accountId,
          phase: "stopped",
          config: structuredClone(config ?? DEFAULT_FARMING_CONFIG),
          games: [],
          activeAppIds: [],
          remainingDrops: 0,
          scannedAt: null,
          startedAt: null,
          truncated: false,
          reason: null,
          canStart: false,
          gameLimit: 32,
          pricing: false,
        },
        generation: 0,
        timer: null,
        activeSince: null,
        applied: false,
        badgeOrder: new Map(),
        cardValues: new Map(),
      };
      this.sessions.set(accountId, session);
    } else if (config && !this.isActive(session)) {
      session.snapshot.config = structuredClone(config);
      this.filterGames(session);
    }
    return structuredClone(session.snapshot);
  }

  captureIntent(accountId: string) {
    this.snapshot(accountId);
    return this.sessions.get(accountId)!.generation;
  }

  async scan(
    accountId: string,
    config: FarmingConfig,
    expectedGeneration?: number,
  ) {
    if (this.shuttingDown) throw new Error("Card farming is shutting down.");
    this.snapshot(accountId, config);
    const session = this.sessions.get(accountId)!;
    if (
      expectedGeneration !== undefined &&
      expectedGeneration !== session.generation
    )
      return this.snapshot(accountId);
    if (this.isActive(session)) return this.snapshot(accountId);
    const generation = ++session.generation;
    session.snapshot.phase = "scanning";
    session.snapshot.reason = null;
    try {
      const discovery = await this.adapter.discover(accountId, () =>
        this.isCurrent(session, generation),
      );
      if (!this.isCurrent(session, generation)) return this.snapshot(accountId);
      this.updateGames(session, discovery);
      session.snapshot.phase = "stopped";
    } catch (error) {
      if (this.isCurrent(session, generation)) {
        session.snapshot.phase = "error";
        session.snapshot.reason = "badge_scan_failed";
      }
      throw error;
    }
    return this.snapshot(accountId);
  }

  async start(
    accountId: string,
    config: FarmingConfig,
    expectedGeneration?: number,
    resumed = false,
  ) {
    if (this.shuttingDown) throw new Error("Card farming is shutting down.");
    this.snapshot(accountId, config);
    const session = this.sessions.get(accountId)!;
    if (
      expectedGeneration !== undefined &&
      expectedGeneration !== session.generation
    )
      return this.snapshot(accountId);
    if (this.isActive(session))
      throw new Error("Card farming is already active.");
    const generation = ++session.generation;
    session.snapshot.config = structuredClone(config);
    session.snapshot.phase = "scanning";
    session.snapshot.startedAt = this.now();
    session.snapshot.reason = null;
    session.applied = false;
    await this.advance(session, generation, true);
    if (this.isActive(session)) {
      this.adapter.remember?.(accountId, true);
      if (resumed) session.snapshot.reason = "resumed";
    }
    return this.snapshot(accountId);
  }

  /** Apply new settings to a running worker without stopping it. */
  reconfigure(accountId: string, config: FarmingConfig) {
    this.snapshot(accountId, config);
    const session = this.sessions.get(accountId)!;
    if (!this.isActive(session)) return this.snapshot(accountId);
    session.snapshot.config = structuredClone(config);
    this.filterGames(session);
    // Between ticks the worker is idle; re-select games now. An in-flight
    // advance reads the new settings itself.
    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
      void this.advance(session, session.generation);
    }
    return this.snapshot(accountId);
  }

  /** Invalidate synchronously before an account stop, pause, conflict, or shutdown. */
  halt(accountId: string, reason = "stopped") {
    const session = this.sessions.get(accountId);
    if (!session) return;
    session.generation += 1;
    if (session.timer) clearTimeout(session.timer);
    session.timer = null;
    session.activeSince = null;
    session.snapshot.activeAppIds = [];
    if (!RESUMABLE_HALTS.has(reason)) this.adapter.remember?.(accountId, false);
    if (reason === "stopped" || this.isActive(session)) {
      session.snapshot.phase = reason === "stopped" ? "stopped" : "blocked";
      session.snapshot.reason = reason === "stopped" ? null : reason;
    }
    session.applied = false;
  }

  async stop(accountId: string) {
    this.snapshot(accountId);
    this.halt(accountId);
    const session = this.sessions.get(accountId)!;
    const generation = session.generation;
    await this.adapter.end(accountId, () =>
      this.isCurrent(session, generation),
    );
    return this.snapshot(accountId);
  }

  beginShutdown() {
    this.shuttingDown = true;
    for (const accountId of this.sessions.keys())
      this.halt(accountId, "shutdown");
  }

  /** A manager may be initialized again after a nonterminal shutdown. */
  initialize() {
    this.shuttingDown = false;
  }

  private isCurrent(session: Session, generation: number) {
    return !this.shuttingDown && session.generation === generation;
  }

  private isActive(session: Session) {
    return ["scanning", "warming", "farming"].includes(session.snapshot.phase);
  }

  private updateGames(
    session: Session,
    discovery: { games: FarmingGame[]; truncated: boolean },
  ) {
    const oldGames = new Map(
      session.snapshot.games.map((game) => [game.appId, game]),
    );
    session.badgeOrder = new Map(
      discovery.games.map((game, index) => [game.appId, index]),
    );
    session.snapshot.games = discovery.games.map((game) => {
      const previous = oldGames.get(game.appId);
      const observed = Math.max(
        game.playtimeMinutes ?? 0,
        previous?.playtimeMinutes ?? 0,
      );
      // Preserve a conservative local estimate when Steam's badge page rounds hours.
      return {
        ...game,
        playtimeMinutes: observed || game.playtimeMinutes,
        skipReason: null,
        cardValue: session.cardValues.get(game.appId)?.value ?? null,
      };
    });
    session.snapshot.scannedAt = this.now();
    session.snapshot.truncated = discovery.truncated;
    session.snapshot.remainingDrops = discovery.games.reduce(
      (total, game) => total + game.remainingDrops,
      0,
    );
    this.filterGames(session);
  }

  private filterGames(session: Session) {
    const { config, games } = session.snapshot;
    for (const game of games) {
      game.skipReason = config.blacklist.includes(game.appId)
        ? "blacklisted"
        : config.whitelist.length > 0 && !config.whitelist.includes(game.appId)
          ? "not_whitelisted"
          : null;
      if (
        game.skipReason ||
        !config.skipRefundable ||
        (game.playtimeMinutes ?? 0) >= 120
      )
        continue;
      game.skipReason =
        game.acquiredAt === null || game.acquiredAt > this.now()
          ? "purchase_date_unknown"
          : this.now() - game.acquiredAt <= 14 * 24 * 60 * 60_000
            ? "refund_window"
            : null;
    }
    this.orderGames(session);
    this.priceGames(session);
  }

  /** Pinned games first in their order, then the chosen strategy, then badge order. */
  private orderGames(session: Session) {
    const { order, priority } = session.snapshot.config;
    const pinned = new Map(priority.map((appId, index) => [appId, index]));
    const badge = (game: FarmingGame) =>
      session.badgeOrder.get(game.appId) ?? Number.MAX_SAFE_INTEGER;
    const strategy = (left: FarmingGame, right: FarmingGame) => {
      switch (order) {
        case "card_value":
          return (
            (right.cardValue?.average ?? -1) - (left.cardValue?.average ?? -1)
          );
        case "drops_desc":
          return right.remainingDrops - left.remainingDrops;
        case "drops_asc":
          return left.remainingDrops - right.remainingDrops;
        case "hours_desc":
          return (right.playtimeMinutes ?? 0) - (left.playtimeMinutes ?? 0);
        case "acquired_asc":
          return (
            (left.acquiredAt ?? Number.MAX_SAFE_INTEGER) -
            (right.acquiredAt ?? Number.MAX_SAFE_INTEGER)
          );
        case "name":
          return left.name.localeCompare(right.name);
        default:
          return 0;
      }
    };
    session.snapshot.games.sort((left, right) => {
      const leftPin = pinned.get(left.appId) ?? Number.MAX_SAFE_INTEGER;
      const rightPin = pinned.get(right.appId) ?? Number.MAX_SAFE_INTEGER;
      return (
        leftPin - rightPin ||
        strategy(left, right) ||
        badge(left) - badge(right)
      );
    });
  }

  /** Looks up missing card prices in the background when ordering by value. */
  private priceGames(session: Session) {
    if (
      !this.adapter.cardValues ||
      session.snapshot.pricing ||
      this.shuttingDown ||
      session.snapshot.config.order !== "card_value"
    )
      return;
    const now = this.now();
    const missing = session.snapshot.games
      .filter((game) => game.remainingDrops > 0 && game.skipReason === null)
      .filter((game) => {
        const known = session.cardValues.get(game.appId);
        return (
          !known ||
          now - known.at >
            (known.value ? CARD_VALUE_TTL : MISSING_CARD_VALUE_TTL)
        );
      })
      .map((game) => game.appId);
    if (missing.length === 0) return;
    session.snapshot.pricing = true;
    const { accountId } = session.snapshot;
    void this.adapter
      .cardValues(
        accountId,
        missing,
        () =>
          !this.shuttingDown && session.snapshot.config.order === "card_value",
      )
      .then((values) => {
        for (const [appId, value] of values)
          session.cardValues.set(appId, { value, at: this.now() });
        for (const game of session.snapshot.games)
          game.cardValue = session.cardValues.get(game.appId)?.value ?? null;
        this.orderGames(session);
      })
      .catch(() => undefined)
      .finally(() => {
        session.snapshot.pricing = false;
      });
  }

  private creditPlaytime(session: Session) {
    if (session.activeSince === null) return;
    const elapsed = Math.max(0, (this.now() - session.activeSince) / 60_000);
    for (const appId of session.snapshot.activeAppIds) {
      const game = session.snapshot.games.find(
        (candidate) => candidate.appId === appId,
      );
      if (!game) continue;
      game.playtimeMinutes = (game.playtimeMinutes ?? 0) + elapsed;
    }
    session.activeSince = this.now();
  }

  private async advance(
    session: Session,
    generation: number,
    forceScan = false,
  ) {
    const { accountId } = session.snapshot;
    const current = () => this.isCurrent(session, generation);
    try {
      const availability = await this.adapter.availability(accountId);
      if (!current()) return;
      session.snapshot.canStart = availability.allowed;
      session.snapshot.gameLimit = availability.gameLimit;
      if (!availability.allowed) {
        const applied = session.applied;
        this.halt(accountId, availability.reason ?? "account_unavailable");
        const cleanupGeneration = session.generation;
        if (applied)
          await this.adapter.end(accountId, () =>
            this.isCurrent(session, cleanupGeneration),
          );
        return;
      }
      if (forceScan && this.adapter.begin) {
        // The account enters farming mode before badge discovery can wait on
        // the network. Clearing its previous payload can itself partly succeed.
        session.applied = true;
        await this.adapter.begin(accountId, current);
        if (!current()) return;
      }
      this.creditPlaytime(session);
      if (
        forceScan ||
        session.snapshot.scannedAt === null ||
        this.now() - session.snapshot.scannedAt >= this.scanMs
      ) {
        const discovery = await this.adapter.discover(accountId, current);
        if (!current()) return;
        this.updateGames(session, discovery);
      }
      this.filterGames(session);
      const eligible = session.snapshot.games.filter(
        (game) => game.skipReason === null && game.remainingDrops > 0,
      );
      const warming = eligible.filter(
        (game) => (game.playtimeMinutes ?? 0) < 120,
      );
      const limit = Math.max(
        0,
        Math.min(
          32,
          session.snapshot.config.maxConcurrentGames,
          availability.gameLimit,
        ),
      );
      const pinned = new Set(session.snapshot.config.priority);
      // A pulled-forward game runs alone before any warm-up batch.
      const first = eligible[0];
      const pulled = first !== undefined && pinned.has(first.appId);
      const warmingUp = !pulled && warming.length > 0;
      const selection = pulled
        ? [first].slice(0, limit)
        : warmingUp
          ? warming.slice(0, limit)
          : eligible.slice(0, Math.min(1, limit));
      const appIds = selection.map((game) => game.appId);
      if (appIds.length === 0) {
        const applied = session.applied;
        session.snapshot.phase = "completed";
        this.adapter.remember?.(accountId, false);
        session.snapshot.reason =
          eligible.length === 0 && session.snapshot.games.length > 0
            ? "no_eligible_games"
            : null;
        session.snapshot.activeAppIds = [];
        session.activeSince = null;
        if (applied) await this.adapter.end(accountId, current);
        return;
      }
      if (appIds.join(",") !== session.snapshot.activeAppIds.join(",")) {
        // gamesPlayed can succeed before a later status write rejects. From
        // this point onward a current failed operation must stop the worker.
        session.applied = true;
        await this.adapter.apply(accountId, appIds, current);
        if (!current()) return;
      }
      session.applied = true;
      session.snapshot.activeAppIds = appIds;
      session.snapshot.phase = warmingUp ? "warming" : "farming";
      session.activeSince = this.now();
      session.timer = setTimeout(() => {
        session.timer = null;
        if (current()) void this.advance(session, generation);
      }, this.tickMs);
      session.timer.unref?.();
    } catch {
      if (!current()) return;
      const applied = session.applied;
      this.halt(accountId, "farming_failed");
      session.snapshot.phase = "error";
      const cleanupGeneration = session.generation;
      if (applied)
        await this.adapter
          .end(accountId, () => this.isCurrent(session, cleanupGeneration))
          .catch(() => undefined);
    }
  }
}
