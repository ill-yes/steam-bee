import type { AccountStatus } from "@steam-bee/contracts";
import type { Account } from "../../api";
import { Badge } from "../../components/ui/badge";
import { cn } from "../../lib/utils";
import { statusLabel, statusTone } from "../../lib/status";
import { useI18n } from "../../i18n";
import { accountActivityStatus, type ActivityTone } from "./activity-status";

export function StatusDot({
  status,
  tone = statusTone(status),
}: {
  status: AccountStatus;
  tone?: ActivityTone;
}) {
  return (
    <span
      className={cn(
        "h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_0_3px_var(--dot-ring)]",
        tone === "good" && "bg-[var(--good)]",
        tone === "info" && "bg-[var(--info)]",
        tone === "warn" && "bg-[var(--warn)]",
        tone === "danger" && "bg-[var(--danger)]",
        tone === "neutral" && "bg-[var(--muted)]",
      )}
      aria-hidden="true"
    />
  );
}

export function StatusBadge({ status }: { status: AccountStatus }) {
  const { messages: t } = useI18n();
  return (
    <Badge tone={statusTone(status)} className="ps-1.5">
      <StatusDot status={status} />
      {statusLabel(status, t)}
    </Badge>
  );
}

/** Status badge that names the running mode (boosting, farming, online). */
export function ActivityBadge({
  account,
}: {
  account: Pick<Account, "runtimeStatus" | "activityMode">;
}) {
  const { locale, messages: t } = useI18n();
  const activity = accountActivityStatus(account, t, locale);
  return (
    <Badge tone={activity.tone} className="ps-1.5">
      <StatusDot status={account.runtimeStatus} tone={activity.tone} />
      {activity.label}
    </Badge>
  );
}
