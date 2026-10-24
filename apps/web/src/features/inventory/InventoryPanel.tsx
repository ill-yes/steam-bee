import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { marketRulesFingerprint } from "@steam-bee/contracts";
import { Package } from "lucide-react";
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
import { interpolate, useI18n } from "../../i18n";
import { inventoryCopy } from "./copy";
import { advancedInventoryCopy } from "./advanced-copy";
import { InventoryBrowser } from "./InventoryBrowser";
import { MarketListingsPanel } from "./MarketListingsPanel";
import { PriceRulesPanel } from "./PriceRulesPanel";
import { BatchPreviewDialog, BatchProgressPanel } from "./BatchMarketPanel";
import { useBatchMarket } from "./useBatchMarket";
import { readPriceRulesDraft } from "./price-rule-draft";
import {
  allocateVariantSale,
  buildInventoryVariants,
  type InventoryVariant,
} from "./inventory-model";
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

// Remount all local state on account changes, including outstanding confirmations.
export function InventoryPanel({ accountId }: { accountId: string }) {
  return <AccountInventoryPanel key={accountId} accountId={accountId} />;
}

function AccountInventoryPanel({ accountId }: { accountId: string }) {
  const { locale, localeInfo, messages } = useI18n();
  const t = locale === "de" ? inventoryCopy.de : inventoryCopy.en;
  const a = advancedInventoryCopy(locale);
  const [view, setView] = useState<"inventory" | "listings" | "rules">(
    "inventory",
  );
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
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionValid, setSelectionValid] = useState(true);
  const [savedRulesFingerprint, setSavedRulesFingerprint] = useState<
    string | null
  >(null);
  const variants = useMemo(
    () => buildInventoryVariants(inventory?.items ?? []),
    [inventory],
  );
  const onSettingsChange = useCallback((settings: MarketPriceSettings) => {
    setSavedRulesFingerprint(marketRulesFingerprint(settings));
  }, []);
  const [rulesEditing, setRulesEditing] = useState(
    () => readPriceRulesDraft(accountId) !== null,
  );
  const [preview, setPreview] = useState<Preview | null>(null);
  const [now, setNow] = useState(Date.now());
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

  const batch = useBatchMarket(accountId, errorMessage, () => {
    setSelected(new Set());
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

  function saleItems(selection: InventoryVariant[]) {
    const items = selection.flatMap((variant) =>
      allocateVariantSale(variant, quantities[variant.variantId] ?? 1),
    );
    if (items.length > 50)
      throw new RangeError(
        locale === "de"
          ? `Diese Auswahl benötigt ${items.length} Marktangebote. Pro Durchlauf sind höchstens 50 möglich. Reduziere die Menge oder Auswahl.`
          : `This selection needs ${items.length} market listings. At most 50 are supported per batch. Reduce the quantity or selection.`,
      );
    return items;
  }

  function previewSale(item: InventoryVariant, trigger: HTMLElement) {
    if (rulesEditing) return;
    let allocations: ReturnType<typeof saleItems>;
    try {
      const latest = variants.find(
        (variant) => variant.variantId === item.variantId,
      );
      if (!latest) throw new RangeError();
      allocations = saleItems([latest]);
    } catch (cause) {
      setActionError(
        cause instanceof RangeError && cause.message
          ? cause.message
          : locale === "de"
            ? "Prüfe die Verkaufsmenge anhand des aktuellen Inventars."
            : "Review the sale quantity against the current inventory.",
      );
      return;
    }
    previewTrigger.current = trigger;
    if (allocations.length > 1) {
      batch.createPreview({ kind: "sale", items: allocations });
      return;
    }
    void perform(
      interpolate(t.preparingSale, { name: item.name }),
      async () => {
        const result = await api<MarketSalePreview>(`${base}/market/preview`, {
          method: "POST",
          signal: controller.current?.signal ?? null,
          body: JSON.stringify({
            assetId: allocations[0]!.assetId,
            quantity: allocations[0]!.quantity,
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
        if (controller.current) void refresh(controller.current.signal);
      },
      true,
    );
  }

  const expired = preview !== null && preview.value.expiresAt <= now;

  return (
    <section className="grid min-w-0 gap-4" aria-label={t.title}>
      <ToolPageHeader
        icon={Package}
        title={t.title}
        description={t.description}
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
      <ToolTabs
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
              <InventoryBrowser
                inventory={inventory}
                loading={inventoryLoading}
                busy={locked}
                stale={!!inventoryError}
                salesBlocked={rulesEditing}
                prices={prices.prices}
                onRetryPrice={prices.retry}
                onVisibleVariantsChange={prices.onVisibleVariantsChange}
                onValidityChange={setSelectionValid}
                quantities={quantities}
                onQuantity={(variantId, value) =>
                  setQuantities((current) => ({
                    ...current,
                    [variantId]: value,
                  }))
                }
                selected={selected}
                onSelection={setSelected}
                onPreview={previewSale}
                onBatchPreview={(trigger) => {
                  if (rulesEditing || !selectionValid) return;
                  previewTrigger.current = trigger;
                  try {
                    const chosen = variants.filter((variant) =>
                      selected.has(variant.variantId),
                    );
                    if (chosen.length !== selected.size || !chosen.length)
                      throw new RangeError();
                    batch.createPreview({
                      kind: "sale",
                      items: saleItems(chosen),
                    });
                  } catch (cause) {
                    setActionError(
                      cause instanceof RangeError && cause.message
                        ? cause.message
                        : locale === "de"
                          ? "Prüfe die Auswahl und Verkaufsmenge anhand des aktuellen Inventars."
                          : "Review the selection and quantities against the current inventory.",
                    );
                  }
                }}
              />
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
      </ToolTabs>
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
                <dd className="text-right font-semibold">
                  {preview.value.quantity}
                </dd>
                <dt className="text-[var(--muted)]">{t.buyerPerItem}</dt>
                <dd className="text-right">
                  {money(
                    preview.value.buyerPaysPerItem,
                    preview.value.currency,
                  )}
                </dd>
                <dt className="text-[var(--muted)]">{t.receivePerItem}</dt>
                <dd className="text-right">
                  {money(
                    preview.value.sellerReceivesPerItem,
                    preview.value.currency,
                  )}
                </dd>
                <dt className="text-[var(--muted)]">{t.steamFee}</dt>
                <dd className="text-right">
                  {money(
                    preview.value.steamFeePerItem * preview.value.quantity,
                    preview.value.currency,
                  )}
                </dd>
                <dt className="text-[var(--muted)]">{t.publisherFee}</dt>
                <dd className="text-right">
                  {money(
                    preview.value.publisherFeePerItem * preview.value.quantity,
                    preview.value.currency,
                  )}
                </dd>
                <dt className="border-t border-[var(--line)] pt-2">
                  {t.totalBuyer}
                </dt>
                <dd className="border-t border-[var(--line)] pt-2 text-right">
                  {money(preview.value.totalBuyerPays, preview.value.currency)}
                </dd>
                <dt className="font-semibold">{t.totalReceive}</dt>
                <dd className="text-right font-semibold text-[var(--good)]">
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
