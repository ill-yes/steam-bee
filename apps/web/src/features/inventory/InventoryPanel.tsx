import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { marketRulesFingerprint } from "@steam-bee/contracts";
import { Package, SlidersHorizontal, Store } from "lucide-react";
import type {
  InventorySnapshot,
  MarketActionResult,
  MarketCurrency,
  MarketListing,
  MarketSalePreview,
  MarketPriceSettings,
} from "@steam-bee/contracts";
import { api, ApiError, apiErrorMessage, isAbortError } from "../../api";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import {
  ToolPageHeader,
  ToolRefreshButton,
} from "../../components/ui/tool-page-header";
import { ToolTabs } from "../../components/ui/tool-tabs";
import type { ComponentProps } from "react";
import { interpolate, useI18n } from "../../i18n";
import { inventoryCopy } from "./copy";
import { advancedInventoryCopy } from "./advanced-copy";
import { hubCopy } from "../accounts/detail/hubCopy";
import { InventorySetBrowser } from "./InventorySetBrowser";
import { SellBasketPanel } from "./SellBasket";
import { formatMoney } from "./inventory-ui";
import { MarketListingsPanel } from "./MarketListingsPanel";
import { PriceRulesPanel } from "./PriceRulesPanel";
import { BatchPreviewDialog, BatchProgressPanel } from "./BatchMarketPanel";
import { useBatchMarket } from "./useBatchMarket";
import { readPriceRulesDraft } from "./price-rule-draft";
import {
  buildInventoryVariants,
  type InventoryVariant,
} from "./inventory-model";
import {
  addToBasket,
  basketAllocations,
  basketEntries,
  basketTotals,
  MAX_SALE_ACTIONS,
  pruneBasket,
  type SellBasket,
} from "./sell-basket";
import { setInventoryCopy } from "./set-copy";
import { useInventoryPrices } from "./useInventoryPrices";

type CancelPreview = {
  token: string;
  expiresAt: number;
  listingId: string;
  name: string;
};
type MarketListings = {
  fetchedAt: number;
  listings: MarketListing[];
  currency: MarketCurrency | null;
};
type Preview =
  | { kind: "sale"; value: MarketSalePreview }
  | { kind: "cancel"; value: CancelPreview };

export type InventoryView = "inventory" | "listings" | "rules";
const CONFIRMATION_POLL_MS = 8_000;
const CONFIRMATION_WATCH_MS = 10 * 60_000;
const CONFIRMATION_GRACE_MS = 30_000;
type InventoryPanelProps = {
  accountId: string;
  /** The account navigation owns the view; standalone use keeps it locally. */
  view?: InventoryView;
  onViewChange?: (view: InventoryView) => void;
};

// Remount all local state on account changes, including outstanding confirmations.
export function InventoryPanel(props: InventoryPanelProps) {
  return <AccountInventoryPanel key={props.accountId} {...props} />;
}

function AccountInventoryPanel({
  accountId,
  view: providedView,
  onViewChange,
}: InventoryPanelProps) {
  const { locale, localeInfo, messages } = useI18n();
  const t = locale === "de" ? inventoryCopy.de : inventoryCopy.en;
  const a = advancedInventoryCopy(locale);
  const s = setInventoryCopy(locale);
  const basketId = useId();
  const [localView, setLocalView] = useState<InventoryView>("inventory");
  const view = providedView ?? localView;
  const hub = hubCopy(locale);
  const pageTitle =
    view === "listings"
      ? hub.listings
      : view === "rules"
        ? hub.rules
        : hub.inventoryNav;
  const pageDescription =
    view === "listings"
      ? hub.listingsDescription
      : view === "rules"
        ? hub.rulesDescription
        : hub.inventoryDescription;
  const setView = (next: InventoryView) => {
    if (providedView === undefined) setLocalView(next);
    onViewChange?.(next);
  };
  const [inventory, setInventory] = useState<InventorySnapshot | null>(null);
  const [market, setMarket] = useState<MarketListings | null>(null);
  const [inventoryError, setInventoryError] = useState("");
  const [marketError, setMarketError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeView, setNoticeView] = useState<"inventory" | "listings">(
    "listings",
  );
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [marketLoading, setMarketLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionProgress, setActionProgress] = useState("");
  const [basket, setBasket] = useState<SellBasket>({});
  const [basketNotice, setBasketNotice] = useState("");
  const [settings, setSettings] = useState<MarketPriceSettings | null>(null);
  const [visibleVariants, setVisibleVariants] = useState<string[]>([]);
  const [clock, setClock] = useState(Date.now);
  const [savedRulesFingerprint, setSavedRulesFingerprint] = useState<
    string | null
  >(null);
  const variants = useMemo(
    () => buildInventoryVariants(inventory?.items ?? []),
    [inventory],
  );
  const entries = useMemo(
    () => basketEntries(basket, variants),
    [basket, variants],
  );
  const onSettingsChange = useCallback((value: MarketPriceSettings) => {
    setSettings(value);
    setSavedRulesFingerprint(marketRulesFingerprint(value));
  }, []);
  const [rulesEditing, setRulesEditing] = useState(
    () => readPriceRulesDraft(accountId) !== null,
  );
  const [preview, setPreview] = useState<Preview | null>(null);
  const [now, setNow] = useState(Date.now());
  // Steam reports no event when a listing is confirmed in the mobile app; poll until it settles.
  const [confirmationWatchUntil, setConfirmationWatchUntil] = useState(0);
  const pendingListingIds = useRef<Set<string> | null>(null);
  const confirmationWatchStarted = useRef(0);
  const active = useRef(false);
  const actionLock = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const rulesView = useRef<HTMLDivElement | null>(null);
  const previewTrigger = useRef<HTMLElement | null>(null);
  const base = `/api/accounts/${encodeURIComponent(accountId)}`;
  const loading = inventoryLoading || marketLoading;

  function errorMessage(error: unknown) {
    // Conflict details explain the Steam prerequisite or stale quote to resolve.
    return error instanceof ApiError && error.code === "CONFLICT"
      ? error.message
      : apiErrorMessage(error, messages);
  }

  const batch = useBatchMarket(accountId, errorMessage, (job) => {
    setBasket({});
    pendingListingIds.current = null;
    // Pending listings may already exist, so the pending-state effect would
    // not re-arm the watch for the new ones.
    if (job.items.some((item) => item.status === "pending_confirmation")) {
      confirmationWatchStarted.current = Date.now();
      setConfirmationWatchUntil(Date.now() + CONFIRMATION_WATCH_MS);
    }
    if (controller.current) void refresh(controller.current.signal);
  });
  const locked = busy || batch.busy || batch.running || batch.recoveryRequired;
  const prices = useInventoryPrices({
    accountId,
    inventoryFetchedAt: inventory?.fetchedAt ?? null,
    currency: market?.currency ?? null,
    rulesFingerprint: savedRulesFingerprint,
    enabled:
      view === "inventory" &&
      inventory !== null &&
      !inventoryLoading &&
      !inventoryError &&
      !busy &&
      !batch.running,
    onContextExpired: async () => {
      if (controller.current) await refresh(controller.current.signal);
    },
    onRulesChanged: async () => {
      const settings = await api<MarketPriceSettings>(
        `${base}/market/settings`,
        {
          signal: controller.current?.signal ?? null,
        },
      );
      if (active.current) onSettingsChange(settings);
    },
  });
  // Basket rows keep their estimates while their cards scroll out of view.
  const priceIds = [...new Set([...visibleVariants, ...Object.keys(basket)])]
    .sort()
    .join("\n");
  const onVisiblePrices = prices.onVisibleVariantsChange;
  useEffect(() => {
    onVisiblePrices(priceIds ? priceIds.split("\n") : []);
  }, [priceIds, onVisiblePrices]);
  useEffect(() => {
    setBasket((current) => pruneBasket(current, variants));
  }, [variants]);
  // The basket shows the saved pause between sales before the rules tab opens.
  const basketFilled = entries.length > 0;
  const settingsKnown = settings !== null;
  useEffect(() => {
    if (!basketFilled || settingsKnown) return;
    const abort = new AbortController();
    api<MarketPriceSettings>(`${base}/market/settings`, {
      signal: abort.signal,
    })
      .then((value) => {
        if (!abort.signal.aborted) onSettingsChange(value);
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, [base, basketFilled, settingsKnown, onSettingsChange]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const previousBatchPreview = useRef(false);
  useEffect(() => {
    if (previousBatchPreview.current && !batch.preview) restorePreviewFocus();
    previousBatchPreview.current = batch.preview !== null;
  }, [batch.preview]);

  async function refresh(signal: AbortSignal) {
    const request = ++generation.current;
    setInventoryLoading(true);
    setMarketLoading(true);
    const current = () =>
      active.current && !signal.aborted && request === generation.current;
    await Promise.allSettled([
      (async () => {
        try {
          const value = await api<InventorySnapshot>(`${base}/inventory`, {
            signal,
          });
          if (current()) {
            setInventory(value);
            setInventoryError("");
          }
        } catch (error) {
          if (current() && !isAbortError(error))
            setInventoryError(errorMessage(error));
        } finally {
          if (current()) setInventoryLoading(false);
        }
      })(),
      (async () => {
        try {
          const value = await api<MarketListings>(`${base}/market/listings`, {
            signal,
          });
          if (current()) {
            setMarket(value);
            setMarketError("");
          }
        } catch (error) {
          if (current() && !isAbortError(error))
            setMarketError(errorMessage(error));
        } finally {
          if (current()) setMarketLoading(false);
        }
      })(),
    ]);
  }

  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    active.current = true;
    void refresh(abort.signal);
    return () => {
      active.current = false;
      abort.abort();
    };
    // AccountInventoryPanel is keyed by accountId; each account owns its requests.
  }, [accountId]);

  useEffect(() => {
    if (!preview) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [preview]);

  useEffect(() => {
    if (!preview || busy || !batch.running) return;
    setPreview(null);
    setActionError(a.previewBlockedByBatch);
    restorePreviewFocus();
  }, [preview, busy, batch.running, a.previewBlockedByBatch]);

  // Every newly pending listing restarts the watch, even while older ones still wait.
  const pendingListingKey =
    market?.listings
      .filter((listing) => listing.pendingConfirmation)
      .map((listing) => listing.listingId)
      .sort()
      .join(",") ?? "";
  useEffect(() => {
    if (!market) return;
    const pending = new Set(
      market.listings
        .filter((listing) => listing.pendingConfirmation)
        .map((listing) => listing.listingId),
    );
    const previous = pendingListingIds.current;
    pendingListingIds.current = pending;
    if (!previous) return;
    const settled = [...previous].filter((id) => !pending.has(id));
    if (settled.length === 0) return;
    const nowActive = settled.some((id) =>
      market.listings.some((listing) => listing.listingId === id),
    );
    setNotice(nowActive ? t.listingConfirmed : t.listingGone);
    setNoticeView("listings");
    // A declined listing returns its item to the inventory; reload both.
    if (!nowActive && controller.current && !actionLock.current)
      void refresh(controller.current.signal);
  }, [market, t.listingConfirmed, t.listingGone]);
  useEffect(() => {
    if (!pendingListingKey) return;
    confirmationWatchStarted.current = Date.now();
    setConfirmationWatchUntil((until) =>
      Math.max(until, Date.now() + CONFIRMATION_WATCH_MS),
    );
  }, [pendingListingKey]);
  const watchingConfirmations = confirmationWatchUntil > clock;
  useEffect(() => {
    if (!watchingConfirmations) return;
    const timer = window.setInterval(() => {
      if (document.hidden || Date.now() > confirmationWatchUntil) return;
      if (actionLock.current) return;
      const signal = controller.current?.signal;
      if (!signal) return;
      const request = generation.current;
      void api<MarketListings>(`${base}/market/listings`, { signal })
        .then((value) => {
          // A full refresh started meanwhile owns the newer result.
          if (!active.current || request !== generation.current) return;
          setMarket(value);
          setMarketError("");
          // Steam can list a fresh sale a moment late; keep looking briefly before giving up.
          if (
            !value.listings.some((listing) => listing.pendingConfirmation) &&
            Date.now() - confirmationWatchStarted.current >
              CONFIRMATION_GRACE_MS
          )
            setConfirmationWatchUntil(0);
        })
        .catch(() => {
          // Polling is best effort; the next tick or a manual refresh retries.
        });
    }, CONFIRMATION_POLL_MS);
    return () => window.clearInterval(timer);
  }, [watchingConfirmations, confirmationWatchUntil, base]);

  function money(amount: number, currency: MarketCurrency) {
    return new Intl.NumberFormat(localeInfo.dateLocale, {
      style: "currency",
      currency: currency.code,
      minimumFractionDigits: currency.minorUnit,
      maximumFractionDigits: currency.minorUnit,
    }).format(amount / 10 ** currency.minorUnit);
  }

  function restorePreviewFocus() {
    window.requestAnimationFrame(() => {
      if (!active.current) return;
      const trigger = previewTrigger.current;
      if (
        trigger?.isConnected &&
        !trigger.matches(":disabled") &&
        !trigger.closest("[hidden]")
      )
        trigger.focus();
      else heading.current?.focus();
    });
  }

  function closePreview() {
    setPreview(null);
    setActionError("");
    restorePreviewFocus();
  }

  function openRules() {
    setView("rules");
    window.requestAnimationFrame(() => {
      if (active.current) rulesView.current?.querySelector("h3")?.focus();
    });
  }

  async function perform(
    progress: string,
    action: () => Promise<void>,
    discardPreviewOnError = false,
  ) {
    if (
      actionLock.current ||
      batch.busy ||
      batch.running ||
      batch.recoveryRequired
    )
      return;
    actionLock.current = true;
    setBusy(true);
    setActionProgress(progress);
    setActionError("");
    setNotice("");
    try {
      await action();
    } catch (error) {
      if (active.current && !isAbortError(error)) {
        if (discardPreviewOnError) setPreview(null);
        setActionError(errorMessage(error));
        restorePreviewFocus();
      }
    } finally {
      actionLock.current = false;
      if (active.current) {
        setBusy(false);
        setActionProgress("");
      }
    }
  }

  function toggleBasket(variant: InventoryVariant) {
    setBasketNotice("");
    if (basket[variant.variantId]) {
      const { [variant.variantId]: _removed, ...rest } = basket;
      setBasket(rest);
      return;
    }
    addVariants([variant]);
  }

  function addVariants(chosen: InventoryVariant[]) {
    const result = addToBasket(basket, chosen, variants);
    setBasket(result.basket);
    setBasketNotice(result.skipped ? s.actionLimit : "");
  }

  function removeVariants(chosen: InventoryVariant[]) {
    const ids = new Set(chosen.map((variant) => variant.variantId));
    setBasketNotice("");
    setBasket((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([id]) => !ids.has(id)),
      ),
    );
  }

  function reviewBasket(trigger: HTMLElement) {
    if (rulesEditing || !entries.length) return;
    let allocations: ReturnType<typeof basketAllocations>;
    try {
      allocations = basketAllocations(entries);
      if (!allocations.length || allocations.length > MAX_SALE_ACTIONS)
        throw new RangeError(s.actionLimit);
    } catch (cause) {
      setActionError(
        cause instanceof RangeError && cause.message === s.actionLimit
          ? s.actionLimit
          : s.basketStale,
      );
      return;
    }
    previewTrigger.current = trigger;
    if (allocations.length > 1) {
      batch.createPreview({ kind: "sale", items: allocations });
      return;
    }
    const [only] = allocations;
    void perform(
      interpolate(t.preparingSale, { name: entries[0]!.variant.name }),
      async () => {
        const result = await api<MarketSalePreview>(`${base}/market/preview`, {
          method: "POST",
          signal: controller.current?.signal ?? null,
          body: JSON.stringify({
            assetId: only!.assetId,
            quantity: only!.quantity,
          }),
        });
        if (active.current) setPreview({ kind: "sale", value: result });
      },
    );
  }

  function previewCancellation(listing: MarketListing, trigger: HTMLElement) {
    previewTrigger.current = trigger;
    void perform(
      interpolate(t.preparingCancellation, { name: listing.name }),
      async () => {
        const result = await api<CancelPreview>(
          `${base}/market/cancel-preview`,
          {
            method: "POST",
            signal: controller.current?.signal ?? null,
            body: JSON.stringify({ listingId: listing.listingId }),
          },
        );
        if (active.current) setPreview({ kind: "cancel", value: result });
      },
    );
  }

  function confirmAction() {
    if (!preview || preview.value.expiresAt <= Date.now()) return;
    const selected = preview;
    void perform(
      selected.kind === "sale" ? t.submittingSale : t.submittingCancellation,
      async () => {
        const result = await api<MarketActionResult>(
          `${base}/market/${selected.kind === "sale" ? "confirm" : "cancel-confirm"}`,
          {
            method: "POST",
            signal: controller.current?.signal ?? null,
            body: JSON.stringify({ token: selected.value.token }),
          },
        );
        if (!active.current) return;
        setPreview(null);
        restorePreviewFocus();
        if (!result.ok) {
          setActionError(result.message);
          return;
        }
        setNotice(
          result.pendingConfirmation
            ? t.confirmationNotice
            : selected.kind === "sale"
              ? t.saleSuccess
              : t.cancelSuccess,
        );
        setNoticeView(selected.kind === "sale" ? "listings" : "inventory");
        if (selected.kind === "sale") setBasket({});
        if (result.pendingConfirmation) {
          confirmationWatchStarted.current = Date.now();
          setConfirmationWatchUntil(Date.now() + CONFIRMATION_WATCH_MS);
        }
        // Own cancellations are not confirmations; start comparing afresh.
        if (selected.kind === "cancel") pendingListingIds.current = null;
        if (controller.current) void refresh(controller.current.signal);
      },
      true,
    );
  }

  const expired = preview !== null && preview.value.expiresAt <= now;

  return (
    <section className="grid min-w-0 gap-4" aria-label={t.title}>
      <ToolPageHeader
        icon={
          view === "listings"
            ? Store
            : view === "rules"
              ? SlidersHorizontal
              : Package
        }
        title={pageTitle}
        description={pageDescription}
        titleRef={heading}
        actions={
          <ToolRefreshButton
            label={t.refresh}
            busy={loading}
            disabled={busy || batch.busy}
            onClick={() => {
              setPreview(null);
              setActionError("");
              if (controller.current) void refresh(controller.current.signal);
              prices.retry();
            }}
          />
        }
      />

      {rulesEditing && view !== "rules" && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--warn-line)] bg-[var(--warn-soft)] p-3 text-xs text-[var(--warn)]"
        >
          <div className="min-w-0 flex-1">
            <strong>{a.unsavedRules}</strong>
            <p className="mt-1 leading-5">{a.unsavedHelp}</p>
          </div>
          <Button size="sm" variant="outline" onClick={openRules}>
            {a.reviewRules}
          </Button>
        </div>
      )}
      {batch.job ? (
        <BatchProgressPanel
          job={batch.job}
          busy={batch.busy}
          pollError={batch.pollError}
          onStop={batch.stop}
          onDismiss={batch.dismiss}
        />
      ) : null}
      {batch.busy && !batch.preview ? (
        <p role="status" className="text-sm text-[var(--muted)]">
          {batch.running ? a.stopping : a.preparingBatch}
        </p>
      ) : null}
      {batch.error && !batch.preview ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {batch.error}
        </p>
      ) : null}
      {(batch.recoveryError || batch.recoveryRequired) && (
        <div
          role="alert"
          className="grid gap-2 rounded-md border border-[var(--warn-line)] bg-[var(--warn-soft)] p-3 text-xs text-[var(--warn)]"
        >
          <p>{a.recoveryHelp}</p>
          {batch.recoveryError && <p>{batch.recoveryError}</p>}
          <Button
            size="sm"
            variant="outline"
            className="justify-self-start"
            disabled={batch.recovering || batch.busy}
            onClick={batch.retryRecovery}
          >
            {batch.recovering ? a.checkingBatch : a.retryBatch}
          </Button>
        </div>
      )}

      {notice ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--info-line)] bg-[var(--info-soft)] p-3 text-sm"
        >
          <p className="min-w-0 flex-1">{notice}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setView(noticeView)}
          >
            {noticeView === "listings" ? a.listingsView : a.inventoryView}
          </Button>
        </div>
      ) : null}
      {actionError && !preview ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {actionError}
        </p>
      ) : null}
      {busy && !preview ? (
        <p role="status" className="text-sm text-[var(--muted)]">
          {actionProgress}
        </p>
      ) : null}
      <ViewFrame
        standalone={providedView === undefined}
        label={a.views}
        value={view}
        onChange={setView}
        items={[
          {
            id: "inventory",
            label: a.inventoryView,
            count: inventory ? variants.length : undefined,
          },
          {
            id: "listings",
            label: a.listingsView,
            count: market?.listings.length,
          },
          { id: "rules", label: a.priceRules },
        ]}
      >
        <div hidden={view !== "inventory"}>
          <div className="grid min-w-0 gap-3">
            {inventoryLoading ? (
              <p role="status" className="text-sm text-[var(--muted)]">
                {t.loading}
              </p>
            ) : null}
            {inventoryError ? (
              <div role="alert" className="text-sm text-[var(--danger)]">
                <p>{inventoryError}</p>
                {inventory ? (
                  <p className="mt-1 text-xs">{t.staleInventory}</p>
                ) : null}
              </div>
            ) : null}

            {inventory ? (
              <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                <InventorySetBrowser
                  accountId={accountId}
                  variants={variants}
                  basket={basket}
                  prices={prices.prices}
                  disabled={locked || inventoryLoading || !!inventoryError}
                  now={clock}
                  onToggle={toggleBasket}
                  onAddGame={addVariants}
                  onRemoveGame={removeVariants}
                  onVisibleVariantsChange={setVisibleVariants}
                />
                <div className="grid min-w-0 gap-2 xl:sticky xl:top-20">
                  {basketNotice && (
                    <p role="alert" className="text-xs text-[var(--warn)]">
                      {basketNotice}
                    </p>
                  )}
                  <SellBasketPanel
                    id={basketId}
                    entries={entries}
                    prices={prices.prices}
                    settings={settings}
                    currency={market?.currency ?? null}
                    now={clock}
                    disabled={locked || inventoryLoading || !!inventoryError}
                    blockedReason={rulesEditing ? s.rulesPending : undefined}
                    onQuantity={(variantId, quantity) =>
                      setBasket((current) =>
                        pruneBasket(
                          { ...current, [variantId]: quantity },
                          variants,
                        ),
                      )
                    }
                    onRemove={(variantId) =>
                      setBasket(({ [variantId]: _removed, ...rest }) => rest)
                    }
                    onClear={() => {
                      setBasket({});
                      setBasketNotice("");
                    }}
                    onReview={reviewBasket}
                    onEditRules={openRules}
                  />
                </div>
                {entries.length > 0 && (
                  <a
                    href={`#${basketId}`}
                    onClick={(event) => {
                      event.preventDefault();
                      const target = document.getElementById(basketId);
                      target?.scrollIntoView?.({ block: "start" });
                      target?.focus({ preventScroll: true });
                    }}
                    className="sticky bottom-3 z-10 flex min-h-11 items-center justify-between gap-3 rounded-full bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-fg)] shadow-lg xl:hidden"
                  >
                    <span>
                      {interpolate(s.jump, {
                        count: entries.length,
                        amount: (() => {
                          const totals = basketTotals(
                            entries,
                            prices.prices,
                            clock,
                          );
                          return totals.priced
                            ? formatMoney(
                                totals.receive,
                                totals.currency,
                                localeInfo.dateLocale,
                              )
                            : "—";
                        })(),
                      })}
                    </span>
                    <span>{s.openBasket}</span>
                  </a>
                )}
              </div>
            ) : null}
          </div>
        </div>

        <section
          hidden={view !== "listings"}
          className="min-w-0"
          aria-label={t.listings}
        >
          <div className="grid min-w-0 gap-3">
            {marketLoading ? (
              <p role="status" className="text-sm text-[var(--muted)]">
                {t.loadingMarket}
              </p>
            ) : null}
            {marketError ? (
              <div role="alert" className="text-sm text-[var(--danger)]">
                <p>{marketError}</p>
                {market ? (
                  <p className="mt-1 text-xs">{t.staleMarket}</p>
                ) : null}
              </div>
            ) : null}
            {market ? (
              <MarketListingsPanel
                market={market}
                loading={marketLoading}
                busy={locked}
                stale={!!marketError}
                onPreview={previewCancellation}
                onRefresh={() => {
                  if (controller.current)
                    void refresh(controller.current.signal);
                }}
                onBatchPreview={(listingIds, trigger) => {
                  previewTrigger.current = trigger;
                  batch.createPreview({ kind: "cancel", listingIds });
                }}
              />
            ) : null}
          </div>
        </section>
        <div ref={rulesView} hidden={view !== "rules"}>
          {marketError && (
            <p role="alert" className="mb-3 text-sm text-[var(--danger)]">
              {marketError}
            </p>
          )}
          <PriceRulesPanel
            accountId={accountId}
            currency={market?.currency ?? null}
            disabled={locked || marketLoading || !!marketError}
            onEditingChange={setRulesEditing}
            onSettingsChange={onSettingsChange}
            embedded
            active={view === "rules"}
          />
        </div>
      </ViewFrame>
      {batch.preview ? (
        <BatchPreviewDialog
          preview={batch.preview}
          busy={batch.busy}
          error={batch.error}
          onClose={() => {
            batch.closePreview();
            restorePreviewFocus();
          }}
          onConfirm={batch.confirm}
        />
      ) : null}

      {preview ? (
        <Dialog
          title={preview.kind === "sale" ? t.saleTitle : t.cancelTitle}
          description={
            preview.kind === "sale" ? t.saleDescription : t.cancelDescription
          }
          onClose={() => {
            if (!busy) closePreview();
          }}
          closeDisabled={busy}
          className="w-[min(32rem,calc(100vw-2rem))]"
          role="alertdialog"
        >
          <div className="grid gap-4">
            <strong className="break-words text-sm">
              {preview.value.name}
            </strong>
            {preview.kind === "sale" ? (
              <p className="text-sm leading-5 text-[var(--warn)]">
                {t.saleWarning}
              </p>
            ) : null}
            {preview.kind === "sale" ? (
              <dl className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 text-sm [&_dd]:break-words [&_dt]:break-words">
                <dt className="text-[var(--muted)]">{t.quantity}</dt>
                <dd className="text-end font-semibold">
                  {preview.value.quantity}
                </dd>
                <dt className="text-[var(--muted)]">{t.buyerPerItem}</dt>
                <dd className="text-end">
                  {money(
                    preview.value.buyerPaysPerItem,
                    preview.value.currency,
                  )}
                </dd>
                <dt className="text-[var(--muted)]">{t.receivePerItem}</dt>
                <dd className="text-end">
                  {money(
                    preview.value.sellerReceivesPerItem,
                    preview.value.currency,
                  )}
                </dd>
                <dt className="text-[var(--muted)]">{t.steamFee}</dt>
                <dd className="text-end">
                  {money(
                    preview.value.steamFeePerItem * preview.value.quantity,
                    preview.value.currency,
                  )}
                </dd>
                <dt className="text-[var(--muted)]">{t.publisherFee}</dt>
                <dd className="text-end">
                  {money(
                    preview.value.publisherFeePerItem * preview.value.quantity,
                    preview.value.currency,
                  )}
                </dd>
                <dt className="border-t border-[var(--line)] pt-2">
                  {t.totalBuyer}
                </dt>
                <dd className="border-t border-[var(--line)] pt-2 text-end">
                  {money(preview.value.totalBuyerPays, preview.value.currency)}
                </dd>
                <dt className="font-semibold">{t.totalReceive}</dt>
                <dd className="text-end font-semibold text-[var(--good)]">
                  {money(
                    preview.value.totalSellerReceives,
                    preview.value.currency,
                  )}
                </dd>
              </dl>
            ) : null}
            <p className="text-xs text-[var(--muted)]">
              {t.expires}:{" "}
              {new Date(preview.value.expiresAt).toLocaleTimeString(
                localeInfo.dateLocale,
              )}
              {!expired
                ? ` · ${interpolate(t.expiresIn, { seconds: Math.max(0, Math.ceil((preview.value.expiresAt - now) / 1000)) })}`
                : ""}
            </p>
            {preview.kind === "sale" ? (
              <p className="text-xs text-[var(--muted)]">
                {t.confirmationHelp}
              </p>
            ) : null}
            {busy ? (
              <p role="status" className="text-sm text-[var(--muted)]">
                {actionProgress}
              </p>
            ) : null}
            {expired ? (
              <p role="alert" className="text-sm text-[var(--warn)]">
                {t.expired}
              </p>
            ) : null}
            {actionError ? (
              <p role="alert" className="text-sm text-[var(--danger)]">
                {actionError}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" disabled={busy} onClick={closePreview}>
                {t.back}
              </Button>
              <Button
                variant="primary"
                disabled={locked || expired}
                onClick={confirmAction}
              >
                {busy
                  ? t.busy
                  : preview.kind === "sale"
                    ? t.sell
                    : t.confirmCancel}
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}

/** Views are tabs on their own; inside the account navigation the sidebar selects them. */
function ViewFrame({
  standalone,
  children,
  ...tabs
}: ComponentProps<typeof ToolTabs<InventoryView>> & { standalone: boolean }) {
  if (standalone) return <ToolTabs {...tabs}>{children}</ToolTabs>;
  return <div className="min-w-0">{children}</div>;
}
