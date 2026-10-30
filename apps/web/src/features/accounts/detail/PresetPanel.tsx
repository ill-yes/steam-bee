import { useState, type ReactNode } from "react";
import { PlaySquare, Plus, Star, Trash2 } from "lucide-react";
import type { PersonaState } from "@steam-bee/contracts";
import type { BoostPreset, BoostSchedule } from "../../../api";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/form";
import { personaLabel } from "../../../lib/status";
import { cn } from "../../../lib/utils";
import { interpolate, useI18n } from "../../../i18n";
import { SteamAppArtwork } from "../../library/SteamAppArtwork";
import { automationCopy } from "./automationCopy";

const personaDot: Record<number, string> = {
  1: "bg-[var(--good)]",
  2: "bg-[var(--danger)]",
  3: "bg-[var(--warn)]",
  7: "bg-[var(--line-strong)]",
};

/** Presets as cards with game artwork; a dashed card saves the current selection. */
export function PresetPanel({
  presets,
  schedules = [],
  activePresetId,
  presetName,
  busyAction,
  selectedCount,
  personaState,
  customTitle,
  onPresetNameChange,
  onCreatePreset,
  onApplyPreset,
  onDeletePreset,
}: {
  presets: BoostPreset[];
  schedules?: BoostSchedule[];
  activePresetId: string | null;
  presetName: string;
  busyAction: string | null;
  selectedCount: number;
  personaState: PersonaState;
  customTitle: string;
  onPresetNameChange: (value: string) => void;
  /** Resolves true once the preset is stored. */
  onCreatePreset: () => Promise<boolean> | void;
  onApplyPreset: (preset: BoostPreset) => void;
  onDeletePreset: (preset: BoostPreset) => void;
}) {
  const { messages: t, locale } = useI18n();
  const c = automationCopy(locale);
  const [creating, setCreating] = useState(false);
  const busy = Boolean(busyAction);
  const title = customTitle.trim();

  async function save() {
    if ((await onCreatePreset()) !== false) setCreating(false);
  }

  return (
    <section className="grid gap-3">
      <ul className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {presets.map((preset) => {
          const active = preset.id === activePresetId;
          const scheduleCount = schedules.filter(
            (schedule) => schedule.presetId === preset.id,
          ).length;
          const names = preset.games.map((game) => game.name);
          return (
            <li
              key={preset.id}
              className={cn(
                "grid min-w-0 overflow-hidden rounded-xl border bg-[var(--surface)]",
                active
                  ? "border-[var(--good)] ring-1 ring-[var(--good)]"
                  : "border-[var(--line)]",
              )}
            >
              <div
                aria-hidden="true"
                className={cn(
                  "grid h-24 gap-0.5 bg-[var(--surface-2)]",
                  preset.games.length >= 3
                    ? "grid-cols-3"
                    : preset.games.length === 2
                      ? "grid-cols-2"
                      : "grid-cols-1",
                )}
              >
                {preset.games.slice(0, 3).map((game) => (
                  <SteamAppArtwork
                    key={game.appId}
                    appId={game.appId}
                    name={game.name}
                    size="fill"
                  />
                ))}
              </div>
              <div className="grid min-w-0 gap-2.5 p-3.5">
                <div className="flex min-w-0 items-center gap-2">
                  <h3 className="min-w-0 flex-1 break-words text-base font-semibold [overflow-wrap:anywhere]">
                    {preset.name}
                  </h3>
                  {active && (
                    <span className="shrink-0 rounded-full bg-[var(--good-soft)] px-2 py-0.5 text-[11px] font-bold text-[var(--good)]">
                      {c.runningNow}
                    </span>
                  )}
                </div>
                <p className="min-w-0 truncate text-sm text-[var(--muted)]">
                  {names.slice(0, 3).join(", ")}
                  {names.length > 3
                    ? ` ${interpolate(c.morePresetGames, { count: names.length - 3 })}`
                    : ""}
                </p>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <Chip>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "h-2 w-2 rounded-full",
                        personaDot[preset.personaState] ??
                          "bg-[var(--line-strong)]",
                      )}
                    />
                    {personaLabel(preset.personaState, t)}
                  </Chip>
                  {preset.customTitle && (
                    <Chip>
                      {interpolate(c.withTitle, {
                        title: preset.customTitle,
                      }).replace(/^ · /, "")}
                    </Chip>
                  )}
                  <Chip>
                    {preset.appIds.length === 1
                      ? c.gameCount
                      : interpolate(c.gamesCount, {
                          count: preset.appIds.length,
                        })}
                  </Chip>
                  {scheduleCount > 0 && (
                    <Chip>
                      {scheduleCount === 1
                        ? c.usedBySchedule
                        : interpolate(c.usedBySchedules, {
                            count: scheduleCount,
                          })}
                    </Chip>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant={active ? "secondary" : "primary"}
                    size="sm"
                    className="min-h-11 flex-1 lg:min-h-9"
                    disabled={busy || active}
                    onClick={() => onApplyPreset(preset)}
                    aria-label={
                      active ? undefined : `${t.tools.apply}: ${preset.name}`
                    }
                  >
                    {!active && <PlaySquare size={15} aria-hidden="true" />}
                    {active ? c.activeButton : t.tools.apply}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    onClick={() => onDeletePreset(preset)}
                    aria-label={`${preset.name} ${t.tools.deletePreset}`}
                    title={t.tools.deletePreset}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
        <li className="min-w-0">
          <button
            type="button"
            disabled={busy || selectedCount === 0}
            onClick={() => setCreating(true)}
            className="grid h-full min-h-56 w-full place-content-center justify-items-center gap-2 rounded-xl border-2 border-dashed border-[var(--line-strong)] p-4 text-center transition-colors hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus size={24} aria-hidden="true" />
            <strong className="text-sm">{c.saveCurrent}</strong>
            <span className="text-xs text-[var(--muted)]">
              {interpolate(c.saveCurrentHint, {
                games:
                  selectedCount === 1
                    ? c.gameCount
                    : interpolate(c.gamesCount, { count: selectedCount }),
                persona: personaLabel(personaState, t),
                title: title ? interpolate(c.withTitle, { title }) : c.noTitle,
              })}
            </span>
          </button>
        </li>
      </ul>
      {presets.length === 0 && (
        <p className="text-sm text-[var(--muted)]">{t.tools.noPresets}</p>
      )}
      {creating && (
        <Dialog
          title={c.newPresetTitle}
          description={c.newPresetDescription}
          onClose={() => setCreating(false)}
          closeDisabled={busyAction === "preset-create"}
          className="max-w-md"
        >
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Input
              value={presetName}
              onChange={(event) => onPresetNameChange(event.target.value)}
              placeholder={t.tools.presetPlaceholder}
              aria-label={t.tools.presetNameAria}
            />
            <p className="text-xs text-[var(--muted)]">
              {interpolate(t.tools.current, {
                count: selectedCount,
                persona: personaLabel(personaState, t),
                titleActive: title ? t.tools.withSteamTitle : "",
              })}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busyAction === "preset-create"}
                onClick={() => setCreating(false)}
              >
                {c.cancel}
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={busy || selectedCount === 0}
              >
                <Star size={15} aria-hidden="true" />
                {t.tools.savePreset}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[var(--muted-strong)]">
      {children}
    </span>
  );
}
