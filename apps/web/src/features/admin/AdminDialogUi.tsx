import type { ReactNode } from "react";
import { Database, KeyRound, RefreshCw, ShieldCheck } from "lucide-react";
import type { AdminOverview } from "../../api";
import { ConfirmationDialog } from "../../components/ui/confirmation-dialog";
import { interpolate, useI18n } from "../../i18n";
import type { ConfirmState } from "./types";

export function AdminSummary({
  overview,
  loading,
}: {
  overview: AdminOverview | null;
  loading: boolean;
}) {
  const { messages: t } = useI18n();

  if (loading && !overview) {
    return (
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-16 animate-pulse rounded-md border border-[var(--line)] bg-[var(--surface-2)]"
          />
        ))}
      </div>
    );
  }

  if (!overview) return null;

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <SummaryTile
        label={t.admin.summary.accounts}
        value={overview.totals.accounts}
        detail={interpolate(t.admin.summary.activeGames, {
          count: overview.totals.selectedGames,
        })}
        icon={<ShieldCheck size={16} />}
      />
      <SummaryTile
        label={t.admin.summary.sessions}
        value={overview.totals.sessions}
        detail={t.admin.summary.adminAccess}
        icon={<KeyRound size={16} />}
      />
      <SummaryTile
        label={t.admin.summary.logs}
        value={overview.totals.events}
        detail={t.admin.summary.localEvents}
        icon={<RefreshCw size={16} />}
      />
      <SummaryTile
        label={t.admin.summary.appData}
        value={overview.totals.appCache}
        detail={interpolate(t.admin.summary.libraryEntries, {
          count: overview.totals.libraryEntries,
        })}
        icon={<Database size={16} />}
      />
    </div>
  );
}

export function ConfirmDialog({
  state,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  state: ConfirmState;
  busy: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { messages: t } = useI18n();

  return (
    <ConfirmationDialog
      title={state.title}
      description={state.body}
      confirmLabel={state.confirmLabel}
      cancelLabel={t.common.cancel}
      busyLabel={t.admin.deleting}
      busy={busy}
      error={error ?? null}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

export function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description ? (
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              {description}
            </p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function LoadingState() {
  const { messages: t } = useI18n();
  return (
    <div className="grid gap-2" role="status" aria-label={t.common.loading}>
      <span className="sr-only">{t.common.loading}</span>
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          key={index}
          className="h-16 animate-pulse rounded-md border border-[var(--line)] bg-[var(--surface-2)]"
        />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border border-dashed border-[var(--line-strong)] bg-[var(--surface-2)] p-4 text-sm text-[var(--muted)]">
      <strong className="block text-[var(--muted-strong)]">{title}</strong>
      <p className="mt-1 leading-5">{children}</p>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: number;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-3">
      <div className="flex items-center justify-between gap-2 text-xs font-semibold text-[var(--muted)]">
        <span>{label}</span>
        <span className="text-[var(--muted-strong)]">{icon}</span>
      </div>
      <strong className="mt-1 block text-2xl leading-none">{value}</strong>
      <p className="mt-1 truncate text-xs text-[var(--muted)]">{detail}</p>
    </div>
  );
}
