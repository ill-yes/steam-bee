import { useId, useRef, type KeyboardEvent } from "react";
import { interpolate, useI18n } from "../../../i18n";
import { cn } from "../../../lib/utils";
import type { FarmingSummary } from "../../farming/useFarmingSummary";
import { hubCopy } from "./hubCopy";

export type ActivityMode = "idle" | "manual" | "farming";

export function ActivityModeSwitch({
  mode,
  connected,
  appliedCount,
  gameLimit,
  farming,
  disabled,
  onSelect,
}: {
  mode: ActivityMode;
  connected: boolean;
  appliedCount: number;
  gameLimit: number;
  farming: FarmingSummary | null;
  disabled: boolean;
  onSelect: (mode: ActivityMode) => void;
}) {
  const { locale, localeInfo } = useI18n();
  const copy = hubCopy(locale);
  const labelId = useId();
  const hintId = useId();
  const buttons = useRef<Partial<Record<ActivityMode, HTMLButtonElement>>>({});
  const farmHint = !farming
    ? copy.modeFarmUnavailable
    : farming.scannedAt === null
      ? copy.modeFarmUnknown
      : farming.remainingDrops > 0
        ? interpolate(copy.modeFarmDrops, {
            drops: farming.remainingDrops,
            games: farming.games,
          })
        : copy.modeFarmNoDrops;
  const options: {
    id: ActivityMode;
    label: string;
    hint: string;
  }[] = [
    {
      id: "idle",
      label: copy.modeNone,
      hint: connected ? copy.modeNoneOnline : copy.modeNoneOffline,
    },
    {
      id: "manual",
      label: copy.modeBoost,
      hint:
        appliedCount > 0
          ? interpolate(copy.modeBoostGames, {
              count: appliedCount,
              limit: gameLimit,
            })
          : copy.modeBoostEmpty,
    },
    { id: "farming", label: copy.modeFarm, hint: farmHint },
  ];

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const forward = localeInfo.dir === "rtl" ? -1 : 1;
    let next: number;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      next = index + (event.key === "ArrowDown" ? 1 : forward);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = index - (event.key === "ArrowUp" ? 1 : forward);
    else return;
    event.preventDefault();
    const option = options[(next + options.length) % options.length]!;
    buttons.current[option.id]?.focus();
  }

  return (
    <div className="grid min-w-0 gap-2">
      <span
        id={labelId}
        className="text-xs font-semibold text-[var(--muted-strong)]"
      >
        {copy.modeLabel}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={hintId}
        className="grid min-w-0 overflow-hidden rounded-lg border border-[var(--line-strong)] bg-[var(--surface-2)] sm:grid-cols-3"
      >
        {options.map((option, index) => {
          const checked = option.id === mode;
          return (
            <button
              key={option.id}
              ref={(node) => {
                if (node) buttons.current[option.id] = node;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              disabled={disabled}
              onClick={() => {
                if (!checked) onSelect(option.id);
              }}
              onKeyDown={(event) => navigate(event, index)}
              className={cn(
                "grid min-h-11 min-w-0 content-center gap-0.5 border-[var(--line-strong)] px-3 py-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60 [&:not(:last-child)]:border-b sm:[&:not(:last-child)]:border-b-0 sm:[&:not(:last-child)]:border-e",
                checked
                  ? "bg-[var(--primary)] text-[var(--primary-fg)]"
                  : "text-[var(--muted-strong)] hover:bg-[var(--surface)]",
              )}
            >
              <span className="text-sm font-semibold">
                {checked ? <span aria-hidden="true">● </span> : null}
                {option.label}
              </span>
              <span
                className={cn(
                  "break-words text-xs",
                  checked ? "opacity-80" : "text-[var(--muted)]",
                )}
              >
                {option.hint}
              </span>
            </button>
          );
        })}
      </div>
      <p id={hintId} className="text-xs leading-5 text-[var(--muted)]">
        {copy.modeExplain}
      </p>
    </div>
  );
}
