import type {
  InventoryPriceOverview,
  InventoryPriceOverviewRow,
  MarketCurrency,
} from "@steam-bee/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, isAbortError } from "../../api";
import { emptyVariantPrice, type VariantPriceState } from "./inventory-prices";

const retryDelay = 60_000;
const permanentErrors = new Set([
  "UNKNOWN_VARIANT",
  "NOT_MARKETABLE",
  "CONTEXT_TOO_LARGE",
]);

function hasVisibleDocument() {
  return document.visibilityState !== "hidden";
}

/** Only visible cards fetch estimates; final sale previews never use this cache. */
export function useInventoryPrices({
  accountId,
  inventoryFetchedAt,
  enabled,
  currency,
  rulesFingerprint,
  onContextExpired,
  onRulesChanged,
}: {
  accountId: string;
  inventoryFetchedAt: number | null;
  enabled: boolean;
  currency: MarketCurrency | null;
  rulesFingerprint: string | null;
  onContextExpired: () => Promise<void>;
  onRulesChanged?: () => Promise<void>;
}) {
  const [prices, setPrices] = useState<Record<string, VariantPriceState>>({});
  const records = useRef<Record<string, VariantPriceState>>({});
  const visible = useRef<string[]>([]);
  const schedule = useRef<(delay?: number) => void>(() => undefined);
  const retryImpl = useRef<(variantId?: string) => void>(() => undefined);
  const repair = useRef({ accountId, used: false, inProgress: false });
  const cooldown = useRef({ accountId, until: 0 });
  const recovery = useRef(onContextExpired);
  const rulesRecovery = useRef(onRulesChanged);
  recovery.current = onContextExpired;
  rulesRecovery.current = onRulesChanged;
  const savedContext = useRef("");
  const wallet = useRef<string | null>(null);
  const observedRules = useRef<string | null>(null);
  const currencyKey = currency ? `${currency.id}:${currency.minorUnit}` : "";

  const onVisibleVariantsChange = useCallback((ids: string[]) => {
    const next = [...new Set(ids)].sort();
    if (next.join("\n") === visible.current.join("\n")) return;
    visible.current = next;
    schedule.current(150);
  }, []);
  const retry = useCallback((variantId?: string) => {
    retryImpl.current(variantId);
  }, []);

  useEffect(() => {
    const context = JSON.stringify([
      accountId,
      inventoryFetchedAt,
      currencyKey,
      rulesFingerprint,
    ]);
    if (context !== savedContext.current) {
      // A repair itself changes fetchedAt. Only a successful price read or an
      // explicit retry reopens its budget; otherwise refreshed snapshots loop.
      if (repair.current.accountId !== accountId)
        repair.current = { accountId, used: false, inProgress: false };
      if (cooldown.current.accountId !== accountId)
        cooldown.current = { accountId, until: 0 };
      savedContext.current = context;
      records.current = {};
      wallet.current = null;
      observedRules.current = null;
      setPrices({});
    }
    let disposed = false;
    let inFlight = false;
    let repairing = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | null = null;
    const repairState = repair.current;

    function publish() {
      if (!disposed) setPrices({ ...records.current });
    }
    function usable(value: VariantPriceState, now: number) {
      return value.currency !== null && (value.displayUntil ?? 0) > now;
    }
    function nextCheck(value: VariantPriceState | undefined) {
      if (!value || value.status === "idle") return 0;
      if (value.error && permanentErrors.has(value.error)) return Infinity;
      if (value.retryAt !== null) return value.retryAt;
      return value.freshUntil ?? Infinity;
    }
    function expire(now: number) {
      let changed = false;
      for (const id of visible.current) {
        const value = records.current[id];
        if (!value) continue;
        if (
          value.currency &&
          value.displayUntil !== null &&
          value.displayUntil <= now
        ) {
          records.current[id] = {
            ...value,
            sourceBuyerPrice: null,
            buyerPrice: null,
            sellerReceivesPerItem: null,
            currency: null,
            status: "error",
            error: value.error ?? "REQUEST_FAILED",
          };
          changed = true;
        } else if (
          value.status === "ready" &&
          (value.freshUntil ?? Infinity) <= now
        ) {
          records.current[id] = { ...value, status: "stale" };
          changed = true;
        }
      }
      if (changed) publish();
    }
    function markFailure(ids: string[], cause: unknown) {
      const now = Date.now();
      const contextExpired =
        cause instanceof ApiError &&
        cause.code === "INVENTORY_PRICE_CONTEXT_EXPIRED";
      const limited = cause instanceof ApiError && cause.status === 429;
      const tooLarge =
        cause instanceof ApiError &&
        cause.code === "INVENTORY_PRICE_CONTEXT_TOO_LARGE";
      if (limited)
        cooldown.current.until = Math.max(
          cooldown.current.until,
          now + retryDelay,
        );
      for (const id of ids) {
        const before = records.current[id] ?? emptyVariantPrice;
        const keep = usable(before, now);
        records.current[id] = {
          ...(keep ? before : emptyVariantPrice),
          status: keep ? "stale" : "error",
          error: tooLarge
            ? "CONTEXT_TOO_LARGE"
            : contextExpired
              ? "CONTEXT_EXPIRED"
              : limited
                ? "RATE_LIMITED"
                : "REQUEST_FAILED",
          retryAt: tooLarge ? null : now + retryDelay,
          refreshing: false,
        };
      }
      publish();
    }
    function fromRow(
      row: InventoryPriceOverviewRow,
      overview: InventoryPriceOverview,
    ): VariantPriceState {
      const now = Date.now();
      const usableCurrency =
        overview.currency !== null && (row.displayUntil ?? 0) > now;
      const hasEstimate = usableCurrency && row.estimate !== null;
      return {
        status: hasEstimate
          ? row.stale || (row.freshUntil ?? 0) <= now
            ? "stale"
            : "ready"
          : "unavailable",
        sourceBuyerPrice: usableCurrency ? row.rawReferenceBuyerPrice : null,
        buyerPrice: hasEstimate ? row.estimate!.buyerPaysPerItem : null,
        sellerReceivesPerItem: hasEstimate
          ? row.estimate!.sellerReceivesPerItem
          : null,
        currency: usableCurrency ? overview.currency : null,
        priceMode: overview.priceMode,
        fetchedAt: row.observedAt,
        freshUntil: row.freshUntil,
        displayUntil: row.displayUntil,
        error: row.error,
        retryAt:
          row.retryAt ??
          (row.error && !permanentErrors.has(row.error)
            ? now + retryDelay
            : null),
        refreshing: false,
      };
    }
    function arm(delay = 150) {
      clearTimeout(timer);
      if (disposed || !enabled || !hasVisibleDocument()) return;
      const now = Date.now();
      const transition = Math.min(
        ...visible.current.flatMap((id) => {
          const value = records.current[id];
          if (!value) return [];
          return [
            value.status === "ready" ? value.freshUntil : null,
            value.currency ? value.displayUntil : null,
          ].filter((time): time is number => time !== null && time > now);
        }),
      );
      timer = setTimeout(
        () => void pump(),
        Math.max(1, Math.min(delay, transition - now)),
      );
    }
    async function pump() {
      if (disposed || !enabled || !hasVisibleDocument()) return;
      const now = Date.now();
      expire(now);
      if (inFlight || repairing) {
        arm(retryDelay);
        return;
      }
      if (cooldown.current.until > now) {
        arm(cooldown.current.until - now);
        return;
      }
      const eligible = visible.current.filter((id) => {
        // Older snapshots remain usable, but cannot make trusted variant reads.
        if (!/^753:6:[1-9]\d{0,24}:\d{1,25}$/.test(id)) {
          if (!records.current[id]) {
            records.current[id] = {
              ...emptyVariantPrice,
              status: "unavailable",
              error: "UNKNOWN_VARIANT",
            };
          }
          return false;
        }
        return true;
      });
      const ids = eligible
        .filter((id) => nextCheck(records.current[id]) <= now)
        .slice(0, 5);
      if (!ids.length) {
        publish();
        const next = Math.min(
          ...eligible.map((id) => nextCheck(records.current[id])),
        );
        if (Number.isFinite(next)) arm(Math.max(150, next - now));
        return;
      }
      inFlight = true;
      request = new AbortController();
      const currentRequest = request;
      const current = () => !disposed && !currentRequest.signal.aborted;
      for (const id of ids) {
        const before = records.current[id] ?? emptyVariantPrice;
        records.current[id] = usable(before, now)
          ? { ...before, refreshing: true }
          : { ...emptyVariantPrice, status: "loading", refreshing: true };
      }
      publish();
      arm(retryDelay);
      try {
        const overview = await api<InventoryPriceOverview>(
          `/api/accounts/${encodeURIComponent(accountId)}/inventory/price-overview`,
          {
            method: "POST",
            signal: currentRequest.signal,
            body: JSON.stringify({ variantIds: ids }),
          },
        );
        if (!current()) return;
        if (
          overview.accountId !== accountId ||
          overview.inventoryFetchedAt < (inventoryFetchedAt ?? 0)
        )
          throw new Error("The price response belongs to another inventory.");
        if (
          rulesFingerprint !== null &&
          overview.rulesFingerprint !== rulesFingerprint
        ) {
          const now = Date.now();
          for (const [id, value] of Object.entries(records.current)) {
            records.current[id] = {
              ...value,
              buyerPrice: null,
              sellerReceivesPerItem: null,
              status: "unavailable",
              error: "REQUEST_FAILED",
              refreshing: false,
              retryAt: now + retryDelay,
            };
          }
          publish();
          if (rulesRecovery.current) {
            repairing = true;
            try {
              await rulesRecovery.current();
            } finally {
              repairing = false;
            }
          }
          return;
        }
        if (
          observedRules.current !== null &&
          overview.rulesFingerprint !== observedRules.current
        ) {
          records.current = {};
        }
        observedRules.current = overview.rulesFingerprint;
        if (
          wallet.current !== null &&
          overview.walletFingerprint !== null &&
          overview.walletFingerprint !== wallet.current
        ) {
          records.current = {};
        }
        if (overview.walletFingerprint !== null)
          wallet.current = overview.walletFingerprint;
        for (const id of ids) {
          const row = overview.rows.find((value) => value.variantId === id);
          if (row) {
            const previous = records.current[id];
            if (
              overview.currency === null &&
              (row.error === "RATE_LIMITED" ||
                row.error === "STEAM_UNAVAILABLE") &&
              previous &&
              usable(previous, Date.now())
            )
              records.current[id] = {
                ...previous,
                status: "stale",
                refreshing: false,
                error: row.error,
                retryAt: row.retryAt ?? Date.now() + retryDelay,
              };
            else records.current[id] = fromRow(row, overview);
          } else markFailure([id], new Error("Price row missing."));
        }
        const limitedRows = overview.rows.filter(
          (row) => row.error === "RATE_LIMITED",
        );
        if (limitedRows.length)
          cooldown.current.until = Math.max(
            cooldown.current.until,
            ...limitedRows.map((row) => row.retryAt ?? Date.now() + retryDelay),
          );
        repairState.used = false;
        publish();
      } catch (cause) {
        if (!current() || isAbortError(cause)) return;
        markFailure(ids, cause);
        if (
          cause instanceof ApiError &&
          cause.code === "INVENTORY_PRICE_CONTEXT_EXPIRED" &&
          !repairState.used
        ) {
          repairState.used = true;
          repairState.inProgress = true;
          repairing = true;
          try {
            await recovery.current();
          } catch {
            // Keep the explicit retry state; never loop on a failed repair.
          } finally {
            repairing = false;
            repairState.inProgress = false;
          }
        }
      } finally {
        inFlight = false;
        if (!disposed) arm();
      }
    }
    function visibilityChanged() {
      if (!hasVisibleDocument()) {
        clearTimeout(timer);
        request?.abort();
        for (const [id, value] of Object.entries(records.current)) {
          if (value?.refreshing)
            records.current[id] =
              value.status === "loading"
                ? { ...emptyVariantPrice }
                : { ...value, refreshing: false };
        }
        publish();
      } else arm();
    }
    schedule.current = arm;
    retryImpl.current = (id) => {
      repairState.used = false;
      for (const target of id ? [id] : visible.current) {
        const value = records.current[target];
        if (
          value?.error === "RATE_LIMITED" &&
          (value.retryAt ?? 0) > Date.now()
        )
          continue;
        delete records.current[target];
      }
      publish();
      arm();
    };
    document.addEventListener("visibilitychange", visibilityChanged);
    expire(Date.now());
    arm();
    return () => {
      disposed = true;
      clearTimeout(timer);
      request?.abort();
      for (const [id, value] of Object.entries(records.current)) {
        if (value.refreshing)
          records.current[id] =
            value.status === "loading"
              ? { ...emptyVariantPrice }
              : { ...value, refreshing: false };
      }
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [accountId, inventoryFetchedAt, currencyKey, rulesFingerprint, enabled]);

  return { prices, onVisibleVariantsChange, retry };
}
