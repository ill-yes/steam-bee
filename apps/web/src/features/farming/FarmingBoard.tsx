import { useId, useState, type ReactNode } from "react";
import type { FarmingGame, FarmingSnapshot } from "@steam-bee/contracts";
import { Ban, Layers } from "lucide-react";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { interpolate, useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { SteamAppArtwork } from "../library/SteamAppArtwork";
import { farmingCopy } from "./copy";

const columnPreview = 6;
type Filters = Pick<FarmingSnapshot["config"], "whitelist" | "blacklist">;

/** Badge games in three columns: running now, waiting, and skipped with the reason. */
export function FarmingBoard({
  snapshot,
  scanning,
  disabled,
  onFilters,
  onRules,
}: {
  snapshot: FarmingSnapshot;
  scanning: boolean;
  /** Quick filters wait while another command runs or a rules draft is open. */
  disabled: boolean;
  onFilters: (filters: Filters) => void;
  onRules: () => void;
}) {
  const { locale } = useI18n();
  const t = farmingCopy(locale);
  const active = new Set(snapshot.activeAppIds);
  const withDrops = snapshot.games.filter((game) => game.remainingDrops > 0);
  const running = withDrops.filter((game) => active.has(game.appId));
  const next = withDrops.filter(
    (game) => !active.has(game.appId) && game.skipReason === null,
  );
  const skipped = withDrops.filter(
    (game) => !active.has(game.appId) && game.skipReason !== null,
  );
  const { whitelist, blacklist } = snapshot.config;

  function exclude(appId: number) {
    onFilters({
      whitelist: whitelist.filter((id) => id !== appId),
      blacklist: [...blacklist, appId],
    });
  }
  function allow(game: FarmingGame) {
    if (game.skipReason === "blacklisted")
      onFilters({
        whitelist,
        blacklist: blacklist.filter((id) => id !== game.appId),
      });
    else onFilters({ whitelist: [...whitelist, game.appId], blacklist });
  }

  if (withDrops.length === 0)
    return (
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
    );

  return (
    <div className="grid min-w-0 gap-3">
      {snapshot.truncated && <Alert tone="info">{t.partial}</Alert>}
      <div
        className="grid min-w-0 items-start gap-3 lg:grid-cols-3"
        role="group"
        aria-label={t.boardLabel}
      >
        <Column title={t.colRunning} empty={t.emptyRunning} games={running}>
          {(game) => (
            <GameCard game={game} highlight>
              <Button
                size="icon"
                variant="ghost"
                disabled={disabled}
                aria-label={interpolate(t.excludeGame, { name: game.name })}
                title={t.exclude}
                onClick={() => exclude(game.appId)}
              >
                <Ban size={15} aria-hidden="true" />
              </Button>
            </GameCard>
          )}
        </Column>
        <Column title={t.colNext} empty={t.emptyNext} games={next}>
          {(game) => (
            <GameCard game={game}>
              <Button
                size="icon"
                variant="ghost"
                disabled={disabled}
                aria-label={interpolate(t.excludeGame, { name: game.name })}
                title={t.exclude}
                onClick={() => exclude(game.appId)}
              >
                <Ban size={15} aria-hidden="true" />
              </Button>
            </GameCard>
          )}
        </Column>
        <Column title={t.colSkipped} empty={t.emptySkipped} games={skipped}>
          {(game) => (
            <GameCard
              game={game}
              detail={
                <p
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-xs font-medium",
                    game.skipReason === "blacklisted"
                      ? "bg-[var(--danger-soft)] text-[var(--danger)]"
                      : "bg-[var(--warn-soft)] text-[var(--warn)]",
                  )}
                >
                  {t.skipDetail[game.skipReason!]}
                </p>
              }
            >
              {game.skipReason === "blacklisted" ||
              game.skipReason === "not_whitelisted" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  aria-label={interpolate(
                    game.skipReason === "blacklisted"
                      ? t.allowAgainGame
                      : t.allowGameNamed,
                    { name: game.name },
                  )}
                  onClick={() => allow(game)}
                >
                  {game.skipReason === "blacklisted"
                    ? t.allowAgain
                    : t.allowGame}
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={onRules}>
                  {t.adjustProtection}
                </Button>
              )}
            </GameCard>
          )}
        </Column>
      </div>
    </div>
  );
}

function Column({
  title,
  empty,
  games,
  children,
}: {
  title: string;
  empty: string;
  games: FarmingGame[];
  children: (game: FarmingGame) => ReactNode;
}) {
  const { locale } = useI18n();
  const t = farmingCopy(locale);
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? games : games.slice(0, columnPreview);
  return (
    <section
      className="grid min-w-0 gap-2 rounded-xl bg-[var(--surface-2)] p-3"
      aria-labelledby={`${id}-title`}
    >
      <h3
        id={`${id}-title`}
        className="flex items-center justify-between gap-2 text-sm font-semibold"
      >
        {title}
        <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-2 text-xs tabular-nums text-[var(--muted-strong)]">
          {games.length}
        </span>
      </h3>
      {games.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--line-strong)] p-3 text-center text-xs text-[var(--muted)]">
          {empty}
        </p>
      ) : (
        <ul className="grid min-w-0 gap-2" aria-label={title}>
          {visible.map((game) => (
            <li key={game.appId} className="min-w-0">
              {children(game)}
            </li>
          ))}
        </ul>
      )}
      {games.length > columnPreview && (
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded
            ? t.showFewer
            : interpolate(t.showAll, { count: games.length })}
        </Button>
      )}
    </section>
  );
}

function GameCard({
  game,
  highlight = false,
  detail,
  children,
}: {
  game: FarmingGame;
  highlight?: boolean;
  detail?: ReactNode;
  /** The card's single action. */
  children: ReactNode;
}) {
  const { locale, localeInfo, messages } = useI18n();
  const t = farmingCopy(locale);
  const hours = new Intl.NumberFormat(localeInfo.dateLocale, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  });
  const meta = (
    <div className="flex min-w-0 items-center gap-2.5">
      <SteamAppArtwork appId={game.appId} name={game.name} size="mini" />
      <div className="min-w-0 flex-1">
        <h4 className="break-words text-sm font-semibold [overflow-wrap:anywhere]">
          {game.name}
        </h4>
        <p className="text-xs text-[var(--muted)]">
          {game.remainingDrops === 1
            ? t.dropsOpenOne
            : interpolate(t.dropsOpen, { count: game.remainingDrops })}
          {" · "}
          <span className="sr-only">{t.hours}: </span>
          {game.playtimeMinutes === null
            ? "—"
            : interpolate(messages.format.hours, {
                count: hours.format(game.playtimeMinutes / 60),
              })}
        </p>
      </div>
      {detail ? null : <div className="shrink-0">{children}</div>}
    </div>
  );
  return (
    <article
      className={cn(
        "grid min-w-0 gap-1.5 rounded-lg border bg-[var(--surface)] p-2",
        highlight ? "border-[var(--accent-line)]" : "border-[var(--line)]",
      )}
    >
      {meta}
      {detail && (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-1">
          {detail}
          {children}
        </div>
      )}
    </article>
  );
}
