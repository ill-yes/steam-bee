import type {
  MarketBatchJob,
  MarketBatchJobItem,
  MarketBatchPreview,
  MarketBatchPreviewItem,
  MarketCurrency,
} from "@steam-bee/contracts";
import { useEffect, useState } from "react";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { interpolate, useI18n } from "../../i18n";
import { advancedInventoryCopy } from "./advanced-copy";
import { inventoryCopy } from "./copy";
import { batchGroupCopy } from "./batch-group-copy";

type GroupableItem = {
  variantId?: string | null;
  assetId: string | null;
  name: string;
  quantity: number;
};

function groupSaleItems<T extends GroupableItem>(items: T[]) {
  const groups = new Map<string, { key: string; name: string; items: T[] }>();
  items.forEach((item, index) => {
    const key = item.variantId
      ? JSON.stringify(["variant", item.variantId])
      : item.assetId
        ? JSON.stringify(["asset", item.assetId])
        : JSON.stringify(["row", index]);
    const group = groups.get(key);
    if (group) group.items.push(item);
    else groups.set(key, { key, name: item.name, items: [item] });
  });
  return [...groups.values()];
}

function totalQuantity(items: { quantity: number }[]) {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

function totalAmount(
  items: MarketBatchPreviewItem[],
  amount: (item: MarketBatchPreviewItem) => number | null,
): number | null {
  let total = 0;
  for (const item of items) {
    const value = amount(item);
    if (value === null || !Number.isFinite(value)) return null;
    total += value;
  }
  return total;
}

function totalFees(items: MarketBatchPreviewItem[]) {
  return totalAmount(items, (item) =>
    item.steamFee === null || item.publisherFee === null
      ? null
      : item.steamFee + item.publisherFee,
  );
}

function PreviewAmounts({
  items,
  currency,
}: {
  items: MarketBatchPreviewItem[];
  currency: MarketCurrency;
}) {
  const { locale } = useI18n();
  const a = advancedInventoryCopy(locale);
  const t = locale === "de" ? inventoryCopy.de : inventoryCopy.en;
  const money = useMoney();
  const format = (value: number | null) =>
    value === null ? "—" : money(value, currency);
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-xs">
      <dt>{t.totalBuyer}</dt>
      <dd className="text-right tabular-nums">
        {format(totalAmount(items, (item) => item.buyerPays))}
      </dd>
      <dt>{a.batchFees}</dt>
      <dd className="text-right tabular-nums">{format(totalFees(items))}</dd>
      <dt className="font-semibold text-[var(--good)]">{t.totalReceive}</dt>
      <dd className="text-right font-semibold tabular-nums text-[var(--good)]">
        {format(totalAmount(items, (item) => item.sellerReceives))}
      </dd>
    </dl>
  );
}

function jobStatusTone(status: MarketBatchJobItem["status"]) {
  return status === "failed"
    ? "danger"
    : status === "pending_confirmation"
      ? "warn"
      : status === "listed" || status === "cancelled"
        ? "good"
        : status === "running"
          ? "info"
          : "neutral";
}

function SalePreviewGroup({
  name,
  items,
  currency,
}: {
  name: string;
  items: MarketBatchPreviewItem[];
  currency: MarketCurrency | null;
}) {
  const { locale } = useI18n();
  const a = advancedInventoryCopy(locale);
  const g = batchGroupCopy(locale);
  const ready = items.filter((item) => item.status === "ready");
  const unavailable = items.filter((item) => item.status === "unavailable");
  return (
    <div
      role="group"
      aria-label={name}
      className="grid min-w-0 gap-3 rounded-md border border-[var(--line)] p-3"
    >
      <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <strong className="break-words text-sm">{name}</strong>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {interpolate(g.groupQuantity, {
              quantity: totalQuantity(items),
              entries: items.length,
            })}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ready.length > 0 && (
              <Badge tone="good" className="whitespace-normal">
                {interpolate(g.ready, {
                  count: ready.length,
                  quantity: totalQuantity(ready),
                })}
              </Badge>
            )}
            {unavailable.length > 0 && (
              <Badge tone="warn" className="whitespace-normal">
                {interpolate(g.unavailable, {
                  count: unavailable.length,
                  quantity: totalQuantity(unavailable),
                })}
              </Badge>
            )}
          </div>
        </div>
        {currency && ready.length > 0 && (
          <PreviewAmounts items={ready} currency={currency} />
        )}
      </div>
      {unavailable.length > 0 && (
        <ul className="grid gap-1 break-words text-xs text-[var(--danger)]">
          {unavailable.map((item, index) => (
            <li key={`${item.assetId}-${index}`}>
              {g.assetId}: {item.assetId ?? "—"} · {item.message ?? a.skipped}
            </li>
          ))}
        </ul>
      )}
      <details className="min-w-0 border-t border-[var(--line)] pt-2">
        <summary
          aria-label={interpolate(g.detailsFor, { name, count: items.length })}
          className="min-h-9 cursor-pointer content-center rounded text-xs font-semibold text-[var(--muted-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        >
          {interpolate(g.details, { count: items.length })}
        </summary>
        <ul className="mt-2 grid min-w-0 gap-2">
          {items.map((item, index) => (
            <li
              key={`${item.assetId}-${index}`}
              className="grid min-w-0 gap-2 rounded border border-[var(--line)] bg-[var(--surface-2)] p-2 sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="min-w-0 text-xs">
                <p className="break-all font-medium">
                  {g.assetId}: {item.assetId ?? "—"}
                </p>
                <p className="mt-1 text-[var(--muted)]">
                  {g.copies}: {item.quantity}
                </p>
                <Badge
                  className="mt-1"
                  tone={item.status === "ready" ? "good" : "warn"}
                >
                  {item.status === "ready"
                    ? g.readyStatus
                    : g.unavailableStatus}
                </Badge>
                {item.message && (
                  <p className="mt-1 break-words text-[var(--muted-strong)]">
                    {item.message}
                  </p>
                )}
              </div>
              {currency && item.status === "ready" && (
                <PreviewAmounts items={[item]} currency={currency} />
              )}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function SaleProgressGroup({
  name,
  items,
}: {
  name: string;
  items: MarketBatchJobItem[];
}) {
  const { locale } = useI18n();
  const a = advancedInventoryCopy(locale);
  const g = batchGroupCopy(locale);
  const statuses: MarketBatchJobItem["status"][] = [
    "listed",
    "pending_confirmation",
    "failed",
    "running",
    "queued",
    "skipped",
    "cancelled",
  ];
  return (
    <div
      role="group"
      aria-label={name}
      className="grid min-w-0 gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] p-3"
    >
      <strong className="break-words text-sm">{name}</strong>
      <p className="text-xs text-[var(--muted)]">
        {interpolate(g.groupQuantity, {
          quantity: totalQuantity(items),
          entries: items.length,
        })}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {statuses.map((status) => {
          const count = items.filter((item) => item.status === status).length;
          return count > 0 ? (
            <Badge
              key={status}
              tone={jobStatusTone(status)}
              className="whitespace-normal"
            >
              {interpolate(g.statusCount, { status: a[status], count })}
            </Badge>
          ) : null;
        })}
      </div>
      <details className="min-w-0 border-t border-[var(--line)] pt-2">
        <summary
          aria-label={interpolate(g.detailsFor, { name, count: items.length })}
          className="min-h-9 cursor-pointer content-center rounded text-xs font-semibold text-[var(--muted-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        >
          {interpolate(g.details, { count: items.length })}
        </summary>
        <ul className="mt-2 grid min-w-0 gap-2">
          {items.map((item, index) => (
            <li
              key={`${item.assetId}-${index}`}
              className="grid min-w-0 gap-1 rounded border border-[var(--line)] bg-[var(--surface-2)] p-2 text-xs"
            >
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 break-all font-medium">
                  {g.assetId}: {item.assetId ?? "—"}
                </p>
                <Badge tone={jobStatusTone(item.status)}>
                  {a[item.status]}
                </Badge>
              </div>
              <p className="text-[var(--muted)]">
                {g.copies}: {item.quantity}
              </p>
              {item.listingId && (
                <p className="break-all text-[var(--muted)]">
                  {g.listingId}: {item.listingId}
                </p>
              )}
              {item.message && (
                <p className="break-words text-[var(--muted-strong)]">
                  {item.message}
                </p>
              )}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function useMoney() {
  const { localeInfo } = useI18n();
  return (amount: number, currency: MarketCurrency) =>
    new Intl.NumberFormat(localeInfo.dateLocale, {
      style: "currency",
      currency: currency.code,
      minimumFractionDigits: currency.minorUnit,
      maximumFractionDigits: currency.minorUnit,
    }).format(amount / 10 ** currency.minorUnit);
}

export function BatchPreviewDialog({
  preview,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  preview: MarketBatchPreview;
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { locale, localeInfo } = useI18n();
  const a = advancedInventoryCopy(locale);
  const g = batchGroupCopy(locale);
  const t = locale === "de" ? inventoryCopy.de : inventoryCopy.en;
  const money = useMoney();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  const expired = preview.expiresAt <= now;
  const ready = preview.items.filter((item) => item.status === "ready");
  const fees = totalFees(ready);
  const saleGroups =
    preview.kind === "sale" ? groupSaleItems(preview.items) : [];
  return (
    <Dialog
      title={preview.kind === "sale" ? a.batchSaleTitle : a.batchCancelTitle}
      description={a.batchDescription}
      role="alertdialog"
      onClose={onClose}
      closeDisabled={busy}
      className="w-[min(48rem,calc(100vw-2rem))]"
    >
      <div className="grid min-w-0 gap-4">
        <p className="text-xs text-[var(--muted)]">
          {preview.kind === "sale"
            ? interpolate(g.previewSummary, {
                variants: saleGroups.length,
                quantity: totalQuantity(preview.items),
                entries: preview.items.length,
                delay: preview.delaySeconds,
              })
            : interpolate(a.batchCount, {
                count: preview.items.length,
                delay: preview.delaySeconds,
              })}
        </p>
        {ready.length < preview.items.length && (
          <Alert tone="warning">
            {interpolate(a.readyItems, {
              ready: ready.length,
              total: preview.items.length,
            })}
          </Alert>
        )}
        {preview.kind === "sale" && !preview.currency && (
          <Alert tone="warning">{t.unavailableCurrency}</Alert>
        )}
        {preview.kind === "sale" && (
          <Alert tone="warning">{t.saleWarning}</Alert>
        )}
        <div
          tabIndex={0}
          role="region"
          aria-label={a.batchItems}
          className="grid max-h-72 min-w-0 gap-2 overflow-y-auto rounded outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          {preview.kind === "sale"
            ? saleGroups.map((group) => (
                <SalePreviewGroup
                  key={group.key}
                  name={group.name}
                  items={group.items}
                  currency={preview.currency}
                />
              ))
            : preview.items.map((item, index) => (
                <div
                  key={`${item.assetId ?? item.listingId}-${index}`}
                  className="grid min-w-0 gap-1 rounded-md border border-[var(--line)] p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <div className="min-w-0">
                    <strong className="break-words text-sm">{item.name}</strong>
                    <p className="text-xs text-[var(--muted)]">
                      {t.quantity}: {item.quantity}
                    </p>
                    {item.status === "unavailable" && (
                      <p className="mt-1 break-words text-xs text-[var(--danger)]">
                        {item.message ?? a.skipped}
                      </p>
                    )}
                  </div>
                </div>
              ))}
        </div>
        {preview.kind === "sale" && preview.currency && (
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-t border-[var(--line)] pt-3 text-sm">
            <dt>{t.totalBuyer}</dt>
            <dd className="text-right">
              {money(preview.totalBuyerPays, preview.currency)}
            </dd>
            <dt>{a.batchFees}</dt>
            <dd className="text-right">
              {fees === null ? "—" : money(fees, preview.currency)}
            </dd>
            <dt className="font-semibold">{t.totalReceive}</dt>
            <dd className="text-right font-semibold text-[var(--good)]">
              {money(preview.totalSellerReceives, preview.currency)}
            </dd>
          </dl>
        )}
        <p className="text-xs text-[var(--muted)]">
          {t.expires}:{" "}
          {new Intl.DateTimeFormat(localeInfo.dateLocale, {
            timeStyle: "medium",
          }).format(preview.expiresAt)}
        </p>
        {preview.kind === "sale" && (
          <p className="text-xs text-[var(--muted)]">{t.confirmationHelp}</p>
        )}
        {expired && <Alert tone="warning">{t.expired}</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
        {busy && (
          <p role="status" className="text-xs text-[var(--muted)]">
            {a.submittingBatch}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {t.back}
          </Button>
          <Button
            disabled={
              busy ||
              expired ||
              ready.length === 0 ||
              (preview.kind === "sale" && !preview.currency)
            }
            onClick={onConfirm}
          >
            {preview.kind === "sale"
              ? a.confirmBatchSale
              : a.confirmBatchCancel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function BatchProgressPanel({
  job,
  busy,
  pollError,
  onStop,
  onDismiss,
}: {
  job: MarketBatchJob;
  busy: boolean;
  pollError: boolean;
  onStop: () => void;
  onDismiss: () => void;
}) {
  const { locale, localeInfo } = useI18n();
  const a = advancedInventoryCopy(locale);
  const g = batchGroupCopy(locale);
  const t = locale === "de" ? inventoryCopy.de : inventoryCopy.en;
  const saleGroups = job.kind === "sale" ? groupSaleItems(job.items) : [];
  const running = job.status === "running" || job.status === "waiting";
  const status = {
    running: a.statusRunning,
    waiting: a.statusWaiting,
    completed: a.statusCompleted,
    stopped: a.statusStopped,
  }[job.status];
  return (
    <section
      className="grid min-w-0 gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3"
      aria-label={a.batchProgress}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{a.batchProgress}</h4>
        <Badge tone={running ? "info" : "neutral"}>{status}</Badge>
      </div>
      <p role="status" className="text-xs">
        {interpolate(a.completed, {
          done: job.completedCount,
          total: job.totalCount,
        })}
      </p>
      <progress
        className="h-2 w-full"
        max={job.totalCount || 1}
        value={job.completedCount}
        aria-label={a.batchProgress}
      />
      {job.kind === "sale" && (
        <div className="grid gap-1 text-xs text-[var(--muted)]">
          <p>
            {interpolate(g.progressSummary, {
              variants: saleGroups.length,
              quantity: totalQuantity(job.items),
              entries: job.items.length,
            })}
          </p>
          <p>
            {interpolate(g.listedOffers, {
              count: job.items.filter((item) => item.status === "listed")
                .length,
            })}
          </p>
        </div>
      )}
      {job.nextActionAt && running && (
        <p className="text-xs text-[var(--muted)]">
          {a.nextAction}:{" "}
          {new Intl.DateTimeFormat(localeInfo.dateLocale, {
            timeStyle: "medium",
          }).format(job.nextActionAt)}
        </p>
      )}
      {pollError && <Alert tone="warning">{a.reconnectProgress}</Alert>}
      {job.items.some((item) => item.status === "pending_confirmation") && (
        <Alert>{t.confirmationNotice}</Alert>
      )}
      <div
        role="region"
        aria-label={a.batchItems}
        tabIndex={0}
        className="grid max-h-64 min-w-0 gap-2 overflow-y-auto rounded outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        {job.kind === "sale"
          ? saleGroups.map((group) => (
              <SaleProgressGroup
                key={group.key}
                name={group.name}
                items={group.items}
              />
            ))
          : job.items.map((item, index) => (
              <div
                key={`${item.assetId ?? item.listingId}-${index}`}
                className="flex min-w-0 flex-wrap items-start justify-between gap-2 border-t border-[var(--line)] pt-2 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <strong className="break-words">{item.name}</strong>
                  {item.message && (
                    <p className="mt-1 break-words text-[var(--muted)]">
                      {item.message}
                    </p>
                  )}
                </div>
                <Badge
                  tone={
                    item.status === "failed"
                      ? "danger"
                      : item.status === "pending_confirmation"
                        ? "warn"
                        : "neutral"
                  }
                >
                  {a[item.status]}
                </Badge>
              </div>
            ))}
      </div>
      <p className="text-xs leading-5 text-[var(--muted)]">{a.stopHelp}</p>
      <div className="flex flex-wrap gap-2">
        {running ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || job.stopRequested}
            onClick={onStop}
          >
            {job.stopRequested ? a.stopping : a.stopBatch}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            {a.dismissJob}
          </Button>
        )}
      </div>
    </section>
  );
}
