import { Badge } from "../../components/ui/badge";
import { cn } from "../../lib/utils";
import { statusLabel, statusTone } from "../../lib/status";
import { useI18n } from "../../i18n";

export function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_0_3px_var(--dot-ring)]",
        statusTone(status) === "good" && "bg-[var(--good)]",
        statusTone(status) === "info" && "bg-[var(--info)]",
        statusTone(status) === "warn" && "bg-[var(--warn)]",
        statusTone(status) === "danger" && "bg-[var(--danger)]",
        statusTone(status) === "neutral" && "bg-[var(--muted)]",
      )}
      aria-hidden="true"
    />
  );
}

export function StatusBadge({ status }: { status: string }) {
  const { messages: t } = useI18n();
  return (
    <Badge tone={statusTone(status)} className="pl-1.5">
      <StatusDot status={status} />
      {statusLabel(status, t)}
    </Badge>
  );
}
