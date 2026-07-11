import {
  CirclePlay,
  ListChecks,
  Pause,
  Save,
  Square,
  Trash2,
} from "lucide-react";
import type { PersonaState } from "@steam-bee/contracts";
import { Button } from "../../../components/ui/button";
import { Input, Label, Select } from "../../../components/ui/form";
import { getPrimaryCommand, personaOptions } from "../../../lib/status";
import { useI18n } from "../../../i18n";

export function AccountControlPanel({
  busyAction,
  canPause,
  canStop,
  eventCount,
  primaryCommand,
  personaState,
  customTitle,
  onPrimaryAction,
  onPause,
  onStop,
  onOpenLogs,
  onDelete,
  onPersonaChange,
  onCustomTitleChange,
  onSaveSettings,
}: {
  busyAction: string | null;
  canPause: boolean;
  canStop: boolean;
  eventCount: number;
  primaryCommand: ReturnType<typeof getPrimaryCommand>;
  personaState: PersonaState;
  customTitle: string;
  onPrimaryAction: () => void;
  onPause: () => void;
  onStop: () => void;
  onOpenLogs: () => void;
  onDelete: () => void;
  onPersonaChange: (value: PersonaState) => void;
  onCustomTitleChange: (value: string) => void;
  onSaveSettings: () => Promise<boolean>;
}) {
  const { messages: t } = useI18n();
  const personas = personaOptions(t);

  return (
    <aside className="grid gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3">
      <div>
        <h3 className="text-sm font-semibold">{t.accountDetail.control}</h3>
      </div>

      <ControlGroup title={t.accountDetail.boosting}>
        <div className="grid grid-cols-2 gap-2">
          {primaryCommand && (
            <Button
              variant="primary"
              size="sm"
              onClick={onPrimaryAction}
              disabled={primaryCommand.disabled || Boolean(busyAction)}
              className="w-full"
            >
              <CirclePlay size={16} />
              {busyAction === primaryCommand.action
                ? t.common.pleaseWait
                : primaryCommand.label}
            </Button>
          )}
          {canPause && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onPause}
              disabled={Boolean(busyAction)}
              className="w-full"
            >
              <Pause size={16} />
              {t.common.pause}
            </Button>
          )}
          {canStop && (
            <Button
              variant="danger"
              size="sm"
              onClick={onStop}
              disabled={Boolean(busyAction)}
              className="w-full"
            >
              <Square size={16} />
              {t.common.stop}
            </Button>
          )}
        </div>
      </ControlGroup>

      <ControlGroup title={t.accountDetail.diagnosisAccount}>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onOpenLogs}
            className="w-full"
          >
            <ListChecks size={16} />
            {t.accountDetail.viewLogs}
            <span className="rounded-full bg-[var(--surface)] px-1.5 text-xs">
              {eventCount}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={Boolean(busyAction)}
            className="w-full text-[var(--danger)]"
          >
            <Trash2 size={16} />
            {t.accountDetail.removeAccount}
          </Button>
        </div>
      </ControlGroup>

      <ControlGroup title={t.accountDetail.steamProfile}>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,120px)_minmax(0,1fr)] sm:items-end">
          <Label htmlFor="persona-state" className="min-w-0">
            {t.accountDetail.visibility}
            <Select
              id="persona-state"
              name="personaState"
              value={personaState}
              onChange={(event) => {
                const value = Number(event.target.value);
                const persona = personas.find(
                  (option) => option.value === value,
                );
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
          <Button
            variant="primary"
            size="sm"
            onClick={() => void onSaveSettings()}
            disabled={busyAction === "settings"}
            className="w-full sm:col-span-2"
          >
            <Save size={16} />
            {busyAction === "settings"
              ? t.common.saving
              : t.accountDetail.saveDisplay}
          </Button>
        </div>
        <p className="text-[11px] leading-4 text-[var(--muted)]">
          {t.accountDetail.titleSlotHint}
        </p>
      </ControlGroup>
    </aside>
  );
}

function ControlGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-2 border-t border-[var(--line)] pt-2 first:border-t-0 first:pt-0">
      <h4 className="text-xs font-semibold text-[var(--muted-strong)]">
        {title}
      </h4>
      {children}
    </section>
  );
}
