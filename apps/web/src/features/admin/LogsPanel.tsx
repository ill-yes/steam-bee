import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import type { AdminOverview, SteamEvent } from "../../api";
import { Button } from "../../components/ui/button";
import { Label, Select } from "../../components/ui/form";
import { interpolate, useI18n, type Messages } from "../../i18n";
import { formatEventTime } from "../../lib/format";
import { eventDisplay } from "../../lib/status";
import { cn } from "../../lib/utils";
import { EmptyState, Section } from "./AdminDialogUi";

export function LogsPanel({
  overview,
  busyAction,
  onDeleteEvent,
  onCleanup,
}: {
  overview: AdminOverview;
  busyAction: string | null;
  onDeleteEvent: (event: SteamEvent) => void;
  onCleanup: (query: string, label: string) => void;
}) {
  const { messages: t, localeInfo } = useI18n();
  const [level, setLevel] = useState("all");
  const [accountId, setAccountId] = useState("all");
  const filteredEvents = useMemo(
    () =>
      overview.events.filter((event) => {
        const levelMatches = level === "all" || event.level === level;
        const accountMatches =
          accountId === "all" || (event.accountId ?? "system") === accountId;
        return levelMatches && accountMatches;
      }),
    [accountId, level, overview.events],
  );
  const olderThan = Date.now() - 7 * 24 * 60 * 60_000;
  const selectedLevelLabel = logLevelLabel(level, t);

  return (
    <Section
      title={t.admin.logsPanel.title}
      description={t.admin.logsPanel.description}
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onCleanup(`olderThan=${olderThan}`, t.admin.cleanupOldLogsBody)
            }
            disabled={busyAction === "events-cleanup"}
          >
            {t.admin.logsPanel.deleteOld}
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() =>
              onCleanup(
                `level=${level}`,
                interpolate(t.admin.cleanupLevelLogsBody, {
                  level: selectedLevelLabel,
                }),
              )
            }
            disabled={level === "all" || busyAction === "events-cleanup"}
          >
            {t.admin.logsPanel.deleteLevel}
          </Button>
        </div>
      }
    >
      <div className="mb-3 grid gap-2 md:grid-cols-2">
        <Label>
          {t.admin.logsPanel.level}
          <Select
            value={level}
            onChange={(event) => setLevel(event.target.value)}
          >
            <option value="all">{t.admin.logsPanel.allLevels}</option>
            <option value="info">{t.admin.logsPanel.info}</option>
            <option value="warn">{t.admin.logsPanel.warning}</option>
            <option value="error">{t.admin.logsPanel.error}</option>
          </Select>
        </Label>
        <Label>
          {t.admin.logsPanel.account}
          <Select
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
          >
            <option value="all">{t.admin.logsPanel.allAccounts}</option>
            <option value="system">{t.admin.logsPanel.system}</option>
            {overview.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.accountName}
              </option>
            ))}
          </Select>
        </Label>
      </div>

      <div className="grid max-h-[430px] gap-2 overflow-auto pr-1">
        {filteredEvents.length === 0 ? (
          <EmptyState title={t.admin.logsPanel.emptyTitle}>
            {t.admin.logsPanel.emptyBody}
          </EmptyState>
        ) : (
          filteredEvents.map((event) => {
            const display = eventDisplay(event, t);
            return (
              <div
                key={event.id}
                className="grid gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-3 sm:grid-cols-[92px_minmax(0,1fr)_auto]"
              >
                <time className="text-xs text-[var(--muted)]">
                  {formatEventTime(event.createdAt, localeInfo)}
                </time>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                        event.level === "error" &&
                          "bg-[var(--danger-soft)] text-[var(--danger)]",
                        event.level === "warn" &&
                          "bg-[var(--warn-soft)] text-[var(--warn)]",
                        event.level === "info" &&
                          "bg-[var(--info-soft)] text-[var(--info)]",
                      )}
                    >
                      {logLevelLabel(event.level, t)}
                    </span>
                    <strong className="truncate text-sm">
                      {display.title}
                    </strong>
                  </div>
                  {display.body ? (
                    <p className="mt-1 text-sm text-[var(--muted-strong)]">
                      {display.body}
                    </p>
                  ) : null}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t.admin.logsPanel.deleteLog}
                  title={t.admin.logsPanel.deleteLog}
                  onClick={() => onDeleteEvent(event)}
                  disabled={busyAction === `event-${event.id}`}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            );
          })
        )}
      </div>
    </Section>
  );
}

function logLevelLabel(level: string, messages: Messages) {
  if (level === "info") return messages.admin.logsPanel.info;
  if (level === "warn") return messages.admin.logsPanel.warning;
  if (level === "error") return messages.admin.logsPanel.error;
  return level;
}
