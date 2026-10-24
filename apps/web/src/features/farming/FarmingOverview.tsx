import { useId, useMemo, useState } from "react";
import type { FarmingSnapshot } from "@steam-bee/contracts";
import { ChevronLeft, ChevronRight, Layers, Settings2 } from "lucide-react";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { interpolate, useI18n } from "../../i18n";
import { SteamAppArtwork } from "../library/SteamAppArtwork";
import { farmingCopy } from "./copy";

const pageSize = 12;

export function FarmingOverview({
  snapshot,
  scanning,
  onSettings,
}: {
  snapshot: FarmingSnapshot;
  scanning: boolean;
  onSettings: () => void;
}) {
  const { locale, localeInfo } = useI18n();
  const t = farmingCopy(locale);
  const id = useId();
  const [page, setPage] = useState(0);
  const activeIds = new Set(snapshot.activeAppIds);
  const games = useMemo(
    () =>
      [...snapshot.games].sort(
        (a, b) =>
          Number(snapshot.activeAppIds.includes(b.appId)) -
            Number(snapshot.activeAppIds.includes(a.appId)) ||
          Number(Boolean(a.skipReason) || a.remainingDrops === 0) -
            Number(Boolean(b.skipReason) || b.remainingDrops === 0),
      ),
    [snapshot.games, snapshot.activeAppIds],
  );
  const lastPage = Math.max(0, Math.ceil(games.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = games.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );
  const hours = new Intl.NumberFormat(localeInfo.dateLocale, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  });
  const ready = games.filter(
    (game) => !game.skipReason && game.remainingDrops > 0,
  ).length;
  const hasScan = snapshot.scannedAt !== null || games.length > 0;

  return (
    <div className="grid min-w-0 gap-4">
      <dl className="grid min-w-0 grid-cols-3 gap-2">
        {[
          { label: t.drops, value: hasScan ? snapshot.remainingDrops : "—" },
          { label: t.activeGames, value: snapshot.activeAppIds.length },
          { label: t.eligibleGames, value: hasScan ? ready : "—" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="flex min-w-0 flex-col rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2 sm:p-3"
          >
            <dt className="min-h-8 break-words text-[11px] leading-4 text-[var(--muted)] sm:min-h-0 sm:text-xs">
              {stat.label}
            </dt>
            <dd className="mt-auto pt-1 text-2xl font-semibold tabular-nums">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-1 text-xs leading-5 text-[var(--muted)]">
        <p>
          {snapshot.scannedAt === null ? (
            t.neverScanned
          ) : (
            <>
              {t.lastScan}:{" "}
              <time dateTime={new Date(snapshot.scannedAt).toISOString()}>
                {new Intl.DateTimeFormat(localeInfo.dateLocale, {
                  dateStyle: "short",
                  timeStyle: "short",
                }).format(snapshot.scannedAt)}
              </time>
            </>
          )}
        </p>
        <p>{t.scanRefreshHint}</p>
      </div>
      <section className="grid min-w-0 gap-3" aria-labelledby={`${id}-queue`}>
        <div>
          <h3 id={`${id}-queue`} className="text-sm font-semibold">
            {t.queue}
          </h3>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            {t.queueHint}
          </p>
        </div>
        {snapshot.truncated && <Alert tone="info">{t.partial}</Alert>}
        {visible.length ? (
          <>
            <ul
              className="grid min-w-0 gap-2 md:grid-cols-2 xl:grid-cols-3"
              aria-label={t.queue}
            >
              {visible.map((game) => {
                const isActive = activeIds.has(game.appId);
                const state = game.skipReason
                  ? t.skip[game.skipReason]
                  : isActive
                    ? t.active
                    : game.remainingDrops > 0
                      ? t.eligible
                      : t.noDrops;
                return (
                  <li
                    key={game.appId}
                    className={`grid min-w-0 gap-2 rounded-lg border p-3 ${isActive ? "border-[var(--accent-line)] bg-[var(--accent-soft)]" : "border-[var(--line)] bg-[var(--surface)]"}`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <SteamAppArtwork
                        appId={game.appId}
                        name={game.name}
                        size="mini"
                      />
                      <div className="min-w-0 flex-1">
                        <h4 className="break-words text-xs font-semibold [overflow-wrap:anywhere]">
                          {game.name}
                        </h4>
                        <span className="text-[11px] text-[var(--muted)]">
                          AppID {game.appId}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={isActive ? "accent" : "neutral"}>
                        {interpolate(t.dropCount, {
                          count: game.remainingDrops,
                        })}
                      </Badge>
                      <span
                        className={`text-xs font-medium ${isActive ? "text-[var(--accent-ink)]" : "text-[var(--muted-strong)]"}`}
                      >
                        {state}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--muted)]">
                      {t.hours}:{" "}
                      {game.playtimeMinutes === null
                        ? "—"
                        : hours.format(game.playtimeMinutes / 60)}
                    </p>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p role="status" className="text-xs text-[var(--muted)]">
                {interpolate(t.gamesPage, {
                  from: currentPage * pageSize + 1,
                  to: Math.min(games.length, (currentPage + 1) * pageSize),
                  total: games.length,
                })}
              </p>
              {lastPage > 0 && (
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    aria-label={t.previousGames}
                    disabled={currentPage === 0}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    <ChevronLeft size={15} aria-hidden="true" />
                  </Button>
                  <Button
                    size="sm"
                    aria-label={t.nextGames}
                    disabled={currentPage === lastPage}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    <ChevronRight size={15} aria-hidden="true" />
                  </Button>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="grid justify-items-start gap-2 rounded-lg border border-dashed border-[var(--line-strong)] bg-[var(--surface-2)] p-4 text-sm text-[var(--muted)]">
            <Layers size={24} aria-hidden="true" />
            <p>
              {scanning
                ? t.scanningEmpty
                : snapshot.scannedAt !== null
                  ? t.noGames
                  : t.empty}
            </p>
          </div>
        )}
      </section>
      <section
        className="grid min-w-0 gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3"
        aria-labelledby={`${id}-rules`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`${id}-rules`} className="text-xs font-semibold">
            {t.savedRules}
          </h3>
          <Button
            size="sm"
            variant="outline"
            className="max-w-full whitespace-normal"
            onClick={onSettings}
          >
            <Settings2 size={14} aria-hidden="true" />
            {t.editSettings}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge>
            {interpolate(t.parallelSummary, {
              count: Math.min(
                snapshot.config.maxConcurrentGames,
                snapshot.gameLimit,
              ),
            })}
          </Badge>
          <Badge tone={snapshot.config.skipRefundable ? "good" : "warn"}>
            {snapshot.config.skipRefundable ? t.protectionOn : t.protectionOff}
          </Badge>
          <Badge>
            {snapshot.config.whitelist.length
              ? interpolate(t.whitelistSummary, {
                  count: snapshot.config.whitelist.length,
                })
              : t.considerAll}
          </Badge>
          {snapshot.config.blacklist.length > 0 && (
            <Badge>
              {interpolate(t.excludedSummary, {
                count: snapshot.config.blacklist.length,
              })}
            </Badge>
          )}
        </div>
      </section>
      <p className="text-xs leading-5 text-[var(--muted)]">{t.note}</p>
    </div>
  );
}
