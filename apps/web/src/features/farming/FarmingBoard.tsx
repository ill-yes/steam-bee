import { useId, useState, type DragEvent, type ReactNode } from "react";
import {
  FARMING_ORDERS,
  type FarmingGame,
  type FarmingOrder,
  type FarmingSnapshot,
} from "@steam-bee/contracts";
import { ArrowUp, Ban, GripVertical, Layers, Pin, PinOff } from "lucide-react";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/form";
import { interpolate, useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { SteamAppArtwork } from "../library/SteamAppArtwork";
import { farmingCopy } from "./copy";

const columnPreview = 6;
type Filters = Partial<
  Pick<
    FarmingSnapshot["config"],
    "whitelist" | "blacklist" | "order" | "priority"
  >
>;

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
  const { whitelist, blacklist, priority, order } = snapshot.config;
  const pinnedIds = new Set(priority);
  const pinned = priority
    .map((appId) => next.find((game) => game.appId === appId))
    .filter((game): game is FarmingGame => game !== undefined);
  const automatic = next.filter((game) => !pinnedIds.has(game.appId));
  const [dragging, setDragging] = useState<number | null>(null);

  function exclude(appId: number) {
    onFilters({
      whitelist: whitelist.filter((id) => id !== appId),
      blacklist: [...blacklist, appId],
      priority: priority.filter((id) => id !== appId),
    });
  }
  /** Puts a game at a position among the pulled-forward games. */
  function pinAt(appId: number, index: number) {
    const rest = pinned.map((game) => game.appId).filter((id) => id !== appId);
    rest.splice(Math.max(0, Math.min(index, rest.length)), 0, appId);
    // Keep pins of games that are running or currently hidden.
    const others = priority.filter(
      (id) => !rest.includes(id) && !pinned.some((game) => game.appId === id),
    );
    onFilters({ priority: [...others, ...rest] });
  }
  function unpin(appId: number) {
    onFilters({ priority: priority.filter((id) => id !== appId) });
  }
  function dropOn(event: DragEvent, index: number | null) {
    event.preventDefault();
    const appId = Number(event.dataTransfer.getData("text/plain"));
    setDragging(null);
    if (!Number.isSafeInteger(appId) || disabled) return;
    if (index === null) {
      if (pinnedIds.has(appId)) unpin(appId);
    } else pinAt(appId, index);
  }
  const dragProps = (game: FarmingGame) => ({
    draggable: !disabled,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.setData("text/plain", String(game.appId));
      event.dataTransfer.effectAllowed = "move";
      setDragging(game.appId);
    },
    onDragEnd: () => setDragging(null),
  });
  const valueChip = (game: FarmingGame) =>
    order !== "card_value" ? null : game.cardValue ? (
      <span className="shrink-0 text-xs font-semibold text-[var(--good)]">
        {interpolate(t.valuePerCard, { value: game.cardValue.text })}
      </span>
    ) : (
      <span className="shrink-0 text-xs text-[var(--muted)]">
        {t.valueLoading}
      </span>
    );
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
            <GameCard game={game} highlight aside={valueChip(game)}>
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
        <NextColumn
          count={next.length}
          order={order}
          disabled={disabled}
          onOrder={(value) => onFilters({ order: value })}
          pinnedSection={
            <ol
              aria-label={t.pinned}
              className={cn(
                "grid min-w-0 gap-2 rounded-lg",
                dragging !== null &&
                  "outline-2 outline-dashed outline-offset-2 outline-[var(--line-strong)]",
              )}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => dropOn(event, pinned.length)}
            >
              {pinned.length === 0 ? (
                <li className="rounded-lg border border-dashed border-[var(--line-strong)] p-2.5 text-center text-xs text-[var(--muted)]">
                  {t.dropHint}
                </li>
              ) : (
                pinned.map((game, index) => (
                  <li
                    key={game.appId}
                    className="min-w-0"
                    {...dragProps(game)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.stopPropagation();
                      dropOn(event, index);
                    }}
                  >
                    <GameCard
                      game={game}
                      lead={
                        <span className="flex shrink-0 items-center gap-0.5 text-xs font-bold text-[var(--muted-strong)]">
                          <GripVertical
                            size={14}
                            aria-hidden="true"
                            className="cursor-grab text-[var(--muted)]"
                          />
                          {index + 1}
                        </span>
                      }
                      aside={valueChip(game)}
                    >
                      <span className="flex">
                        {index > 0 && (
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={disabled}
                            aria-label={interpolate(t.moveUp, {
                              name: game.name,
                            })}
                            title={interpolate(t.moveUp, { name: game.name })}
                            onClick={() => pinAt(game.appId, index - 1)}
                          >
                            <ArrowUp size={15} aria-hidden="true" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={disabled}
                          aria-label={interpolate(t.unpinGame, {
                            name: game.name,
                          })}
                          title={t.unpin}
                          onClick={() => unpin(game.appId)}
                        >
                          <PinOff size={15} aria-hidden="true" />
                        </Button>
                      </span>
                    </GameCard>
                  </li>
                ))
              )}
            </ol>
          }
        >
          <div
            className="grid min-w-0 gap-2"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => dropOn(event, null)}
          >
            <Column
              title={t.autoAfter}
              empty={t.emptyNext}
              games={automatic}
              bare
            >
              {(game) => (
                <div className="min-w-0" {...dragProps(game)}>
                  <GameCard game={game} aside={valueChip(game)}>
                    <span className="flex">
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled={disabled}
                        aria-label={interpolate(t.pinGame, { name: game.name })}
                        title={t.pin}
                        onClick={() => pinAt(game.appId, pinned.length)}
                      >
                        <Pin size={15} aria-hidden="true" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled={disabled}
                        aria-label={interpolate(t.excludeGame, {
                          name: game.name,
                        })}
                        title={t.exclude}
                        onClick={() => exclude(game.appId)}
                      >
                        <Ban size={15} aria-hidden="true" />
                      </Button>
                    </span>
                  </GameCard>
                </div>
              )}
            </Column>
          </div>
        </NextColumn>
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
  bare = false,
  children,
}: {
  title: string;
  empty: string;
  games: FarmingGame[];
  /** Renders only the list, inside another column. */
  bare?: boolean;
  children: (game: FarmingGame) => ReactNode;
}) {
  const { locale } = useI18n();
  const t = farmingCopy(locale);
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? games : games.slice(0, columnPreview);
  const list = (
    <>
      {games.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--line-strong)] p-3 text-center text-xs text-[var(--muted)]">
          {empty}
        </p>
      ) : (
        <ul className="grid min-w-0 gap-2" aria-label={title || undefined}>
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
    </>
  );
  if (bare) return list;
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
      {list}
    </section>
  );
}

function GameCard({
  game,
  highlight = false,
  detail,
  lead,
  aside,
  children,
}: {
  game: FarmingGame;
  highlight?: boolean;
  detail?: ReactNode;
  lead?: ReactNode;
  aside?: ReactNode;
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
      {lead}
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
        {aside && <p className="mt-0.5">{aside}</p>}
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

function NextColumn({
  count,
  order,
  disabled,
  onOrder,
  pinnedSection,
  children,
}: {
  count: number;
  order: FarmingOrder;
  disabled: boolean;
  onOrder: (order: FarmingOrder) => void;
  pinnedSection: ReactNode;
  children: ReactNode;
}) {
  const { locale } = useI18n();
  const t = farmingCopy(locale);
  const id = useId();
  return (
    <section
      className="grid min-w-0 gap-2 rounded-xl bg-[var(--surface-2)] p-3"
      aria-labelledby={`${id}-title`}
    >
      <h3
        id={`${id}-title`}
        className="flex items-center justify-between gap-2 text-sm font-semibold"
      >
        {t.colNext}
        <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-2 text-xs tabular-nums text-[var(--muted-strong)]">
          {count}
        </span>
      </h3>
      <label className="flex min-w-0 items-center gap-2 text-xs text-[var(--muted-strong)]">
        <span className="shrink-0">{t.order}</span>
        <Select
          value={order}
          disabled={disabled}
          onChange={(event) => onOrder(event.target.value as FarmingOrder)}
          className="min-w-0 flex-1 bg-[var(--surface)] disabled:opacity-50"
        >
          {FARMING_ORDERS.map((value) => (
            <option key={value} value={value}>
              {t.orders[value]}
            </option>
          ))}
        </Select>
      </label>
      <h4 className="mt-1 text-[11px] font-bold tracking-wide text-[var(--muted)] uppercase">
        {t.pinned}
      </h4>
      {pinnedSection}
      <h4 className="mt-1 text-[11px] font-bold tracking-wide text-[var(--muted)] uppercase">
        {t.autoAfter}
      </h4>
      {children}
    </section>
  );
}
