import { Pause, Play, Power, RefreshCw, Square, Trash2 } from "lucide-react";
import {
  ACCOUNT_STATUS_CAPABILITIES,
  type AccountStatus,
} from "@steam-bee/contracts";
import type { AdminOverview } from "../../api";
import { Button } from "../../components/ui/button";
import { useI18n, type Messages } from "../../i18n";
import { statusLabel } from "../../lib/status";
import { EmptyState, Section } from "./AdminDialogUi";
import type { AdminAccount } from "./types";

export function AccountsPanel({
  overview,
  busyAction,
  onCommand,
  onForget,
}: {
  overview: AdminOverview;
  busyAction: string | null;
  onCommand: (
    accountId: string,
    command: "start" | "pause" | "resume" | "stop",
  ) => void;
  onForget: (account: AdminAccount) => void;
}) {
  const { messages: t } = useI18n();

  return (
    <Section
      title={t.admin.accountsPanel.title}
      description={t.admin.accountsPanel.description}
    >
      <div className="grid gap-2">
        {overview.accounts.length === 0 ? (
          <EmptyState title={t.admin.accountsPanel.emptyTitle}>
            {t.admin.accountsPanel.emptyBody}
          </EmptyState>
        ) : (
          overview.accounts.map((account) => {
            const statusCapability =
              ACCOUNT_STATUS_CAPABILITIES[account.runtimeStatus];
            const sessionAction = adminSessionAction(account.runtimeStatus, t);
            const SessionIcon = sessionAction.icon;

            return (
              <div
                key={account.id}
                className="grid gap-3 rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-3 xl:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="truncate text-sm">
                      {account.accountName}
                    </strong>
                    <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-2 py-0.5 text-[11px] font-semibold text-[var(--muted-strong)]">
                      {statusLabel(account.runtimeStatus, t)}
                    </span>
                  </div>
                  <p className="mt-1 truncate font-mono text-xs text-[var(--muted)]">
                    {account.steamId ?? t.admin.accountsPanel.noSteamId}
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-[var(--muted)] md:grid-cols-5">
                    <MiniMetric
                      label={t.admin.accountsPanel.games}
                      value={account.selectedGameCount}
                    />
                    <MiniMetric
                      label={t.admin.accountsPanel.library}
                      value={account.libraryAppCount}
                    />
                    <MiniMetric
                      label={t.admin.accountsPanel.presets}
                      value={account.presetCount}
                    />
                    <MiniMetric
                      label={t.admin.accountsPanel.schedules}
                      value={account.scheduleCount}
                    />
                    <MiniMetric
                      label={t.admin.accountsPanel.logs}
                      value={account.eventCount}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 xl:w-[300px]">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onCommand(account.id, sessionAction.command)}
                    disabled={
                      sessionAction.disabled ||
                      busyAction === `${sessionAction.command}-${account.id}`
                    }
                  >
                    <SessionIcon size={14} />
                    {sessionAction.label}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onCommand(account.id, "stop")}
                    disabled={
                      !statusCapability.canStop ||
                      busyAction === `stop-${account.id}`
                    }
                  >
                    <Square size={14} />
                    {t.common.stop}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => onForget(account)}
                    disabled={busyAction === `forget-${account.id}`}
                  >
                    <Trash2 size={14} />
                    {t.common.remove}
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Section>
  );
}

function adminSessionAction(status: AccountStatus, messages: Messages) {
  const command = ACCOUNT_STATUS_CAPABILITIES[status].adminCommand;
  if (command === null) {
    return {
      command: "start" as const,
      label: messages.status.primaryCommand.connecting,
      icon: RefreshCw,
      disabled: true,
    };
  }

  if (command === "resume") {
    return {
      command: "resume" as const,
      label: messages.common.resume,
      icon: Play,
      disabled: false,
    };
  }

  if (command === "start") {
    return {
      command: "start" as const,
      label: messages.common.start,
      icon: Power,
      disabled: false,
    };
  }

  return {
    command: "pause" as const,
    label: messages.common.pause,
    icon: Pause,
    disabled: false,
  };
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-md bg-[var(--surface)] px-2 py-1">
      <strong className="text-[var(--muted-strong)]">{value}</strong> {label}
    </span>
  );
}
