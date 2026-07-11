import { PlaySquare, Star, Trash2 } from "lucide-react";
import type { PersonaState } from "@steam-bee/contracts";
import type { BoostPreset } from "../../../api";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/form";
import { personaLabel } from "../../../lib/status";
import { interpolate, useI18n } from "../../../i18n";

export function PresetPanel({
  presets,
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
  activePresetId: string | null;
  presetName: string;
  busyAction: string | null;
  selectedCount: number;
  personaState: PersonaState;
  customTitle: string;
  onPresetNameChange: (value: string) => void;
  onCreatePreset: () => void;
  onApplyPreset: (preset: BoostPreset) => void;
  onDeletePreset: (preset: BoostPreset) => void;
}) {
  const { messages: t } = useI18n();

  return (
    <section className="grid gap-3">
      <div>
        <h3 className="text-sm font-semibold">{t.tools.boostPresets}</h3>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          {t.tools.presetsDescription}
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Input
          value={presetName}
          onChange={(event) => onPresetNameChange(event.target.value)}
          placeholder={t.tools.presetPlaceholder}
          aria-label={t.tools.presetNameAria}
        />
        <Button
          variant="primary"
          size="sm"
          disabled={Boolean(busyAction) || selectedCount === 0}
          onClick={onCreatePreset}
        >
          <Star size={15} />
          {t.tools.savePreset}
        </Button>
      </div>
      <p className="text-[11px] leading-4 text-[var(--muted)]">
        {interpolate(t.tools.current, {
          count: selectedCount,
          persona: personaLabel(personaState, t),
          titleActive: customTitle.trim() ? t.tools.withSteamTitle : "",
        })}
      </p>
      <div className="grid max-h-56 gap-2 overflow-auto pr-1">
        {presets.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--line-strong)] p-3 text-sm text-[var(--muted)]">
            {t.tools.noPresets}
          </div>
        ) : (
          presets.map((preset) => (
            <div
              key={preset.id}
              className="grid gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <strong className="block truncate text-sm">
                    {preset.name}
                  </strong>
                  <span className="text-xs text-[var(--muted)]">
                    {preset.appIds.length} {t.common.games} ·{" "}
                    {personaLabel(preset.personaState, t)}
                    {preset.customTitle ? t.tools.titleActive : ""}
                  </span>
                </div>
                {preset.id === activePresetId ? (
                  <Badge tone="good">{t.tools.active}</Badge>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className="flex-1"
                  disabled={Boolean(busyAction)}
                  onClick={() => onApplyPreset(preset)}
                >
                  <PlaySquare size={15} />
                  {t.tools.apply}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={Boolean(busyAction)}
                  onClick={() => onDeletePreset(preset)}
                  aria-label={`${preset.name} ${t.tools.deletePreset}`}
                  title={t.tools.deletePreset}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
