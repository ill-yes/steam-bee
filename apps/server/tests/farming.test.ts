import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FARMING_CONFIG, type FarmingGame } from "@steam-bee/contracts";
import {
  discoverBadgeDrops,
  enrichBadgeGames,
  MAX_BADGE_PAGES,
  parseBadgePage,
} from "../src/farming/badges.js";
import {
  FarmingController,
  type FarmingAdapter,
} from "../src/farming/controller.js";

const accountId = "account";
const oldPurchase = Date.UTC(2026, 0, 1);

function game(
  appId: number,
  playtimeMinutes: number | null = 180,
  acquiredAt: number | null = null,
): FarmingGame {
  return {
    appId,
    name: `Game ${appId}`,
    remainingDrops: 3,
    playtimeMinutes,
    acquiredAt,
    skipReason: null,
  };
}

function setup(games: FarmingGame[], gameLimit = 32) {
  const adapter: FarmingAdapter = {
    discover: vi.fn(async () => ({
      games: structuredClone(games),
      truncated: false,
    })),
    availability: vi.fn(async () => ({
      allowed: true,
      reason: null,
      gameLimit,
    })),
    apply: vi.fn(async (_accountId, _appIds, shouldApply) => {
      expect(shouldApply()).toBe(true);
    }),
    end: vi.fn(async () => undefined),
  };
  const controller = new FarmingController(adapter);
  return { adapter, controller };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("Steam badge discovery", () => {
  it("reads only remaining regular card drops and handles markup and pagination", () => {
    const parsed = parseBadgePage(`<div class="badges_sheet">
      <div class="badge_row is_link"><a href="https://steamcommunity.com/profiles/1/gamecards/10/"></a>
        <div class="badge_title">Some &amp; Game <div class="badge_title_stats_playtime">1.5 hrs on record</div></div>
        <span class="progress_info_bold">3 card drops remaining</span></div>
      <div class="badge_row"><a href="/my/gamecards/20/"></a><div class="badge_title">Finished</div>No card drops remaining</div>
      <a href="?p=3&amp;l=english">3</a></div>`);
    expect(parsed).toEqual({
      pageCount: 3,
      games: [
        expect.objectContaining({
          appId: 10,
          name: "Some & Game",
          remainingDrops: 3,
          playtimeMinutes: 84,
          acquiredAt: null,
        }),
      ],
    });
  });

  it("rejects login pages, unexpected formats, and oversized pages", () => {
    expect(() => parseBadgePage('<form id="login_form"></form>')).toThrow(
      /sign-in/,
    );
    expect(() => parseBadgePage("Steam error")).toThrow(/recognizable/);
    expect(() => parseBadgePage("x".repeat(2_000_001))).toThrow(/oversized/);
  });

  it("bounds pagination and reports partial discovery", async () => {
    const fetchPage = vi.fn(
      async () =>
        '<div class="badges_sheet"><a href="?p=999999">Next</a></div>',
    );
    const discovery = await discoverBadgeDrops(fetchPage);
    expect(fetchPage).toHaveBeenCalledTimes(MAX_BADGE_PAGES);
    expect(discovery).toEqual({ games: [], truncated: true });
  });
});

describe("card farming lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 1, 1));
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("protects unknown and recent purchases below two hours by default", async () => {
    const { controller, adapter } = setup([
      game(1, 0),
      game(2, 60, Date.now() - 86_400_000),
      game(3, 180),
    ]);
    const result = await controller.start(accountId, DEFAULT_FARMING_CONFIG);
    expect(result.games.map((entry) => entry.skipReason)).toEqual([
      "purchase_date_unknown",
      "refund_window",
      null,
    ]);
    expect(result.phase).toBe("farming");
    expect(adapter.apply).toHaveBeenCalledWith(
      accountId,
      [3],
      expect.any(Function),
    );
  });

  it("does not treat rounded 2.0 badge hours as proof of two hours played", async () => {
    const parsed = parseBadgePage(
      `<div class="badges_sheet"><div class="badge_row"><a href="/profiles/76561198000000000/gamecards/10/"></a><div class="badge_title">Rounded game</div><span>2.0 hrs on record</span><span>3 card drops remaining</span></div></div>`,
    );
    enrichBadgeGames(parsed.games, [
      { appId: 10, name: "Rounded game", playtimeMinutes: 117 },
    ]);
    const { controller, adapter } = setup(parsed.games);
    const protectedResult = await controller.start(
      accountId,
      DEFAULT_FARMING_CONFIG,
    );
    expect(protectedResult.games[0]).toMatchObject({
      playtimeMinutes: 117,
      skipReason: "purchase_date_unknown",
    });
    expect(adapter.apply).not.toHaveBeenCalled();
    enrichBadgeGames(parsed.games, [
      { appId: 10, name: "Rounded game", playtimeMinutes: 120 },
    ]);
    vi.mocked(adapter.discover).mockResolvedValue({
      games: parsed.games,
      truncated: false,
    });
    expect(
      (await controller.start(accountId, DEFAULT_FARMING_CONFIG)).activeAppIds,
    ).toEqual([10]);
  });

  it("warms eligible games together then targets a single game at two hours", async () => {
    const { controller, adapter } = setup([
      game(1, 119, oldPurchase),
      game(2, 119, oldPurchase),
    ]);
    expect(
      (await controller.start(accountId, DEFAULT_FARMING_CONFIG)).phase,
    ).toBe("warming");
    expect(adapter.apply).toHaveBeenLastCalledWith(
      accountId,
      [1, 2],
      expect.any(Function),
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(controller.snapshot(accountId).phase).toBe("farming");
    expect(adapter.apply).toHaveBeenLastCalledWith(
      accountId,
      [1],
      expect.any(Function),
    );
  });

  it("honors the existing game cap, whitelist and blacklist precedence", async () => {
    const games = Array.from({ length: 40 }, (_, index) =>
      game(index + 1, 1, oldPurchase),
    );
    const { controller, adapter } = setup(games, 31);
    await controller.start(accountId, DEFAULT_FARMING_CONFIG);
    expect(vi.mocked(adapter.apply).mock.calls[0]?.[1]).toHaveLength(31);
    await controller.stop(accountId);
    const result = await controller.start(accountId, {
      ...DEFAULT_FARMING_CONFIG,
      whitelist: [1, 2],
      blacklist: [2],
    });
    expect(result.activeAppIds).toEqual([1]);
    expect(result.games.find((entry) => entry.appId === 2)?.skipReason).toBe(
      "blacklisted",
    );
    expect(result.games.find((entry) => entry.appId === 3)?.skipReason).toBe(
      "not_whitelisted",
    );
  });

  it("allows an explicit opt out of conservative refund protection", async () => {
    const { controller } = setup([game(1, null)]);
    const result = await controller.start(accountId, {
      ...DEFAULT_FARMING_CONFIG,
      skipRefundable: false,
    });
    expect(result.phase).toBe("warming");
    expect(result.activeAppIds).toEqual([1]);
  });

  it("does not start after stop while a badge request is pending", async () => {
    const { controller, adapter } = setup([]);
    const pending = deferred<{ games: FarmingGame[]; truncated: boolean }>();
    vi.mocked(adapter.discover).mockReturnValue(pending.promise);
    const starting = controller.start(accountId, DEFAULT_FARMING_CONFIG);
    await Promise.resolve();
    await controller.stop(accountId);
    pending.resolve({ games: [game(1)], truncated: false });
    await starting;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(controller.snapshot(accountId).phase).toBe("stopped");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the manual payload before waiting for badge discovery", async () => {
    const { controller, adapter } = setup([]);
    const sent: number[][] = [[99]];
    const pending = deferred<{ games: FarmingGame[]; truncated: boolean }>();
    const enteredDiscovery = deferred<void>();
    adapter.begin = vi.fn(async (_id, shouldApply) => {
      if (shouldApply()) sent.push([]);
    });
    vi.mocked(adapter.discover).mockImplementation(async () => {
      enteredDiscovery.resolve();
      return pending.promise;
    });
    vi.mocked(adapter.apply).mockImplementation(
      async (_id, ids, shouldApply) => {
        if (shouldApply()) sent.push(ids);
      },
    );
    const starting = controller.start(accountId, DEFAULT_FARMING_CONFIG);
    await enteredDiscovery.promise;
    expect(sent).toEqual([[99], []]);
    expect(controller.snapshot(accountId).phase).toBe("scanning");
    await controller.stop(accountId);
    pending.resolve({ games: [game(1)], truncated: false });
    await starting;
    expect(sent).toEqual([[99], []]);
    expect(adapter.apply).not.toHaveBeenCalled();
  });

  it("does not discover or apply after a queued begin loses ownership", async () => {
    const { controller, adapter } = setup([game(1)]);
    const pending = deferred<void>();
    const enteredBegin = deferred<void>();
    const sent = vi.fn();
    adapter.begin = vi.fn(async (_id, shouldApply) => {
      enteredBegin.resolve();
      await pending.promise;
      if (shouldApply()) sent([]);
    });
    const starting = controller.start(accountId, DEFAULT_FARMING_CONFIG);
    await enteredBegin.promise;
    controller.halt(accountId, "manual-start");
    pending.resolve();
    await starting;
    expect(sent).not.toHaveBeenCalled();
    expect(adapter.discover).not.toHaveBeenCalled();
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(adapter.end).not.toHaveBeenCalled();
  });

  it("cleans up a partially successful begin before badge discovery", async () => {
    const { controller, adapter } = setup([game(1)]);
    const sent = vi.fn();
    adapter.begin = vi.fn(async () => {
      sent([]);
      throw new Error("Status write failed after clearing the old payload");
    });
    vi.mocked(adapter.end).mockImplementation(async (_id, shouldEnd) => {
      expect(shouldEnd?.()).toBe(true);
    });
    const result = await controller.start(accountId, DEFAULT_FARMING_CONFIG);
    expect(sent).toHaveBeenCalledWith([]);
    expect(adapter.end).toHaveBeenCalledOnce();
    expect(adapter.discover).not.toHaveBeenCalled();
    expect(result).toMatchObject({ phase: "error", reason: "farming_failed" });
  });

  it("does not let delayed stop cleanup pause a newer manual activity", async () => {
    const { controller, adapter } = setup([game(1)]);
    await controller.start(accountId, DEFAULT_FARMING_CONFIG);
    const pending = deferred<void>();
    const enteredEnd = deferred<void>();
    const paused = vi.fn();
    vi.mocked(adapter.end).mockImplementation(async (_id, shouldEnd) => {
      enteredEnd.resolve();
      await pending.promise;
      if (shouldEnd?.()) paused();
    });
    const stopping = controller.stop(accountId);
    await enteredEnd.promise;
    controller.halt(accountId, "manual-start");
    pending.resolve();
    await stopping;
    expect(paused).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not let delayed stop cleanup pause a newer farming activity", async () => {
    const { controller, adapter } = setup([game(1)]);
    await controller.start(accountId, DEFAULT_FARMING_CONFIG);
    const pending = deferred<void>();
    const enteredEnd = deferred<void>();
    const paused = vi.fn();
    vi.mocked(adapter.end).mockImplementation(async (_id, shouldEnd) => {
      enteredEnd.resolve();
      await pending.promise;
      if (shouldEnd?.()) paused();
    });
    const stopping = controller.stop(accountId);
    await enteredEnd.promise;
    await controller.start(accountId, DEFAULT_FARMING_CONFIG);
    pending.resolve();
    await stopping;
    expect(paused).not.toHaveBeenCalled();
    expect(controller.snapshot(accountId)).toMatchObject({
      phase: "farming",
      activeAppIds: [1],
    });
  });

  it("does not let delayed failure cleanup pause a newer farming activity", async () => {
    const { controller, adapter } = setup([game(1)]);
    const pending = deferred<void>();
    const enteredEnd = deferred<void>();
    const paused = vi.fn();
    vi.mocked(adapter.apply).mockRejectedValueOnce(
      new Error("Failed after applying games"),
    );
    vi.mocked(adapter.end).mockImplementation(async (_id, shouldEnd) => {
      enteredEnd.resolve();
      await pending.promise;
      if (shouldEnd?.()) paused();
    });
    const firstStart = controller.start(accountId, DEFAULT_FARMING_CONFIG);
    await enteredEnd.promise;
    expect(controller.snapshot(accountId).phase).toBe("error");
    await controller.start(accountId, DEFAULT_FARMING_CONFIG);
    pending.resolve();
    await firstStart;
    expect(paused).not.toHaveBeenCalled();
    expect(controller.snapshot(accountId)).toMatchObject({
      phase: "farming",
      activeAppIds: [1],
    });
  });

  it("invalidates a queued adapter mutation after a manual pause", async () => {
    const { controller, adapter } = setup([game(1)]);
    const pending = deferred<void>();
    const sent = vi.fn();
    vi.mocked(adapter.apply).mockImplementation(
      async (_id, ids, shouldApply) => {
        await pending.promise;
        if (shouldApply()) sent(ids);
      },
    );
    const starting = controller.start(accountId, DEFAULT_FARMING_CONFIG);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    controller.halt(accountId, "account_paused");
    pending.resolve();
    await starting;
    expect(sent).not.toHaveBeenCalled();
    expect(controller.snapshot(accountId).phase).toBe("blocked");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops a possibly applied selection when a later status write fails", async () => {
    const { controller, adapter } = setup([game(1)]);
    const sent = vi.fn();
    vi.mocked(adapter.apply).mockImplementation(async (_id, ids) => {
      sent(ids);
      throw new Error("Status persistence failed after gamesPlayed");
    });
    const result = await controller.start(accountId, DEFAULT_FARMING_CONFIG);
    expect(sent).toHaveBeenCalledWith([1]);
    expect(adapter.end).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      phase: "error",
      activeAppIds: [],
      reason: "farming_failed",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not bypass an active hold and never resumes after the hold clears", async () => {
    const { controller, adapter } = setup([game(1)]);
    await controller.start(accountId, DEFAULT_FARMING_CONFIG);
    vi.mocked(adapter.availability).mockResolvedValue({
      allowed: false,
      reason: "safety_hold",
      gameLimit: 32,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(adapter.end).toHaveBeenCalledTimes(1);
    expect(controller.snapshot(accountId)).toMatchObject({
      phase: "blocked",
      reason: "safety_hold",
      activeAppIds: [],
    });
    vi.mocked(adapter.availability).mockResolvedValue({
      allowed: true,
      reason: null,
      gameLimit: 32,
    });
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(adapter.apply).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("refreshes drop counts and pauses after all drops are exhausted", async () => {
    const { controller, adapter } = setup([game(1)]);
    await controller.start(accountId, DEFAULT_FARMING_CONFIG);
    vi.mocked(adapter.discover).mockResolvedValue({
      games: [],
      truncated: false,
    });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(controller.snapshot(accountId)).toMatchObject({
      phase: "completed",
      activeAppIds: [],
      remainingDrops: 0,
    });
    expect(adapter.end).toHaveBeenCalledOnce();
    controller.halt(accountId, "account_paused");
    expect(controller.snapshot(accountId).phase).toBe("completed");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start a stale HTTP intent captured before stop", async () => {
    const { controller, adapter } = setup([game(1)]);
    const intent = controller.captureIntent(accountId);
    await controller.stop(accountId);
    await controller.start(accountId, DEFAULT_FARMING_CONFIG, intent);
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(adapter.discover).not.toHaveBeenCalled();
  });

  it("invalidates pending discovery on shutdown and initialization never revives it", async () => {
    const { controller, adapter } = setup([]);
    const pending = deferred<{ games: FarmingGame[]; truncated: boolean }>();
    vi.mocked(adapter.discover).mockReturnValue(pending.promise);
    const starting = controller.start(accountId, DEFAULT_FARMING_CONFIG);
    await Promise.resolve();
    controller.beginShutdown();
    controller.initialize();
    pending.resolve({ games: [game(1)], truncated: false });
    await starting;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    controller.beginShutdown();
    await expect(
      controller.scan(accountId, DEFAULT_FARMING_CONFIG),
    ).rejects.toThrow(/shutting down/);
  });

  it("scans without starting any games", async () => {
    const { controller, adapter } = setup([game(1)]);
    adapter.begin = vi.fn(async () => undefined);
    expect(
      (await controller.scan(accountId, DEFAULT_FARMING_CONFIG)).games,
    ).toHaveLength(1);
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(adapter.begin).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
