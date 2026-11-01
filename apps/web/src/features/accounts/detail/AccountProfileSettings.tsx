import { Save, Trash2 } from "lucide-react";
import type { PersonaState } from "@steam-bee/contracts";
import { Button } from "../../../components/ui/button";
import { Input, Label, Select } from "../../../components/ui/form";
import { personaOptions } from "../../../lib/status";
import { useI18n } from "../../../i18n";
import { hubCopy } from "./hubCopy";

export function AccountProfileSettings({
  busyAction,
  personaState,
  customTitle,
  onPersonaChange,
  onCustomTitleChange,
  onSaveSettings,
}: {
  busyAction: string | null;
  personaState: PersonaState;
  customTitle: string;
  onPersonaChange: (value: PersonaState) => void;
  onCustomTitleChange: (value: string) => void;
  onSaveSettings: () => Promise<boolean>;
}) {
  const { locale, messages: t } = useI18n();
  const hub = hubCopy(t);
  const personas = personaOptions(t);

  return (
    <section className="grid gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
      <h3 className="text-sm font-semibold">{hub.steamProfile}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Label htmlFor="persona-state" className="min-w-0">
          {t.accountDetail.visibility}
          <Select
            id="persona-state"
            name="personaState"
            value={personaState}
            onChange={(event) => {
              const value = Number(event.target.value);
              const persona = personas.find((option) => option.value === value);
              if (persona) onPersonaChange(persona.value);
            }}
          >
            {personas.map((persona) => (
              <option key={persona.value} value={persona.value}>
                {persona.label}
              </option>
            ))}
          </Select>
        </Label>
        <Label htmlFor="custom-title" className="min-w-0">
          {t.accountDetail.steamTitle}
          <Input
            id="custom-title"
            name="customTitle"
            value={customTitle}
            maxLength={80}
            onChange={(event) => onCustomTitleChange(event.target.value)}
            placeholder={t.common.optional}
          />
        </Label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-xs leading-5 text-[var(--muted)]">
          {t.accountDetail.titleSlotHint}
        </p>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void onSaveSettings()}
          disabled={busyAction === "settings"}
        >
          <Save size={16} aria-hidden="true" />
          {busyAction === "settings"
            ? t.common.saving
            : t.accountDetail.saveDisplay}
        </Button>
      </div>
    </section>
  );
}

export function AccountDangerZone({
  busy,
  onDelete,
}: {
  busy: boolean;
  onDelete: () => void;
}) {
  const { locale, messages: t } = useI18n();
  const hub = hubCopy(t);
  return (
    <section className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--danger-line)] bg-[var(--surface)] p-4">
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-[var(--danger)]">
          {hub.dangerTitle}
        </h3>
        <p className="text-xs leading-5 text-[var(--muted)]">
          {hub.dangerText}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onDelete}
        disabled={busy}
        className="text-[var(--danger)]"
      >
        <Trash2 size={16} aria-hidden="true" />
        {t.accountDetail.removeAccount}
      </Button>
    </section>
  );
}
