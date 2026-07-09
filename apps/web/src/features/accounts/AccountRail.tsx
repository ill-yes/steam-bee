import {
  KeyRound,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  ShieldCheck,
} from "lucide-react";
import type { Account } from "../../api";
import { Button } from "../../components/ui/button";
import { interpolate, useI18n } from "../../i18n";
import { accountStats, statusLabel } from "../../lib/status";
import { cn } from "../../lib/utils";
import { AccountAvatar } from "./AccountAvatar";
import { StatusDot } from "./StatusIndicators";

export function AccountRail({
  accounts,
  selected,
  collapsed,
  onToggleCollapsed,
  onSelect,
  onAdd,
  onOpenAdmin,
}: {
  accounts: Account[];
  selected: Account | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onOpenAdmin: () => void;
}) {
  const { messages: t } = useI18n();
  const stats = accountStats(accounts);

  return (
    <aside
      className={cn(
        "sticky top-[76px] hidden max-h-[calc(100vh-92px)] min-h-[calc(100vh-92px)] overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] shadow-[var(--panel-shadow)] lg:grid",
        collapsed
          ? "w-[76px] grid-rows-[auto_minmax(0,1fr)_auto]"
          : "w-[304px] grid-rows-[auto_auto_minmax(0,1fr)_auto]",
      )}
      aria-label={t.rail.aria}
    >
      <div
        className={cn(
          "flex items-center gap-2 border-b border-[var(--line)] p-3",
          collapsed ? "flex-col justify-center" : "justify-between",
        )}
      >
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
              {t.rail.eyebrow}
            </p>
            <h2 className="truncate text-lg font-semibold">{t.rail.title}</h2>
          </div>
        )}
        <div className={cn("flex items-center gap-2", collapsed && "flex-col")}>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? t.rail.expand : t.rail.collapse}
            title={collapsed ? t.rail.expand : t.rail.collapse}
          >
            {collapsed ? (
              <PanelLeftOpen size={17} />
            ) : (
              <PanelLeftClose size={17} />
            )}
          </Button>
          <Button
            variant="primary"
            size={collapsed ? "icon" : "sm"}
            onClick={onAdd}
            aria-label={t.rail.add}
            title={t.rail.add}
          >
            <Plus size={16} />
            {!collapsed && t.common.new}
          </Button>
        </div>
      </div>

      {!collapsed && (
        <div className="grid grid-cols-4 border-b border-[var(--line)] bg-[var(--line)]">
          <RailMetric label={t.rail.total} value={stats.total} />
          <RailMetric label={t.rail.online} value={stats.active} tone="good" />
          <RailMetric label={t.rail.pause} value={stats.paused} tone="info" />
          <RailMetric
            label={t.rail.attention}
            value={stats.attention}
            tone="danger"
          />
        </div>
      )}

      {accounts.length === 0 ? (
        <div
          className={cn(
            "m-2 flex items-center gap-2 rounded-md border border-dashed border-[var(--line-strong)] bg-[var(--surface-2)] p-3 text-sm text-[var(--muted-strong)]",
            collapsed && "justify-center",
          )}
        >
          <KeyRound size={17} />
          {!collapsed && <span>{t.rail.empty}</span>}
        </div>
      ) : (
        <div className="grid content-start gap-2 overflow-auto p-2">
          {accounts.map((account) => (
            <button
              key={account.id}
              type="button"
              className={cn(
                "relative grid min-h-14 w-full items-center gap-2 rounded-md border border-transparent text-left transition hover:border-[var(--line)] hover:bg-[var(--surface-2)]",
                collapsed
                  ? "grid-cols-1 justify-items-center p-2"
                  : "grid-cols-[auto_36px_minmax(0,1fr)_auto] px-2 py-2",
                selected?.id === account.id &&
                  "border-[var(--info-line)] bg-[var(--selected)] shadow-[inset_3px_0_0_var(--info)]",
                collapsed &&
                  selected?.id === account.id &&
                  "shadow-[inset_0_0_0_2px_var(--info)]",
              )}
              onClick={() => onSelect(account.id)}
              aria-label={interpolate(t.rail.accountAria, {
                accountName: account.accountName,
                status: statusLabel(account.runtimeStatus, t),
                count: account.games.length,
              })}
              title={`${account.accountName} - ${statusLabel(
                account.runtimeStatus,
                t,
              )}`}
            >
              <span
                className={cn(
                  collapsed && "absolute right-2 top-2",
                  !collapsed && "contents",
                )}
              >
                <StatusDot status={account.runtimeStatus} />
              </span>
              <AccountAvatar account={account} size="md" />
              {!collapsed && (
                <>
                  <span className="grid min-w-0 gap-0.5">
                    <strong className="truncate text-sm">
                      {account.accountName}
                    </strong>
                    <small className="truncate text-xs text-[var(--muted)]">
                      {statusLabel(account.runtimeStatus, t)}
                    </small>
                  </span>
                  <span className="grid h-6 min-w-7 place-items-center rounded-full border border-[var(--line)] bg-[var(--surface)] px-2 text-xs font-bold text-[var(--muted-strong)]">
                    {account.games.length}
                  </span>
                </>
              )}
            </button>
          ))}
        </div>
      )}

      <div
        className={cn(
          "border-t border-[var(--line)] p-2",
          collapsed ? "grid place-items-center" : "grid gap-2",
        )}
      >
        <Button
          variant="ghost"
          size={collapsed ? "icon" : "md"}
          className={cn(!collapsed && "w-full justify-start")}
          onClick={onOpenAdmin}
          aria-label={t.rail.adminOpen}
          title={t.rail.adminOpen}
        >
          <ShieldCheck size={17} />
          {!collapsed && t.common.admin}
        </Button>
      </div>
    </aside>
  );
}

function RailMetric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "good" | "info" | "danger";
}) {
  return (
    <div className="min-w-0 bg-[var(--surface-2)] p-2.5">
      <strong
        className={cn(
          "block text-lg leading-none",
          tone === "good" && "text-[var(--good)]",
          tone === "info" && "text-[var(--info)]",
          tone === "danger" && "text-[var(--danger)]",
        )}
      >
        {value}
      </strong>
      <span className="mt-1 block truncate text-[11px] font-semibold text-[var(--muted)]">
        {label}
      </span>
    </div>
  );
}
