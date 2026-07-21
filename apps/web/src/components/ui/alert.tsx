import type { HTMLAttributes, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "../../lib/utils";

type AlertTone = "info" | "success" | "warning" | "danger";

export function Alert({
  tone = "info",
  icon,
  className,
  children,
  role,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  tone?: AlertTone;
  icon?: ReactNode;
}) {
  const defaultIcon =
    tone === "danger" || tone === "warning" ? (
      <AlertTriangle size={16} />
    ) : tone === "success" ? (
      <CheckCircle2 size={16} />
    ) : (
      <Info size={16} />
    );

  return (
    <div
      role={
        role ??
        (tone === "danger" || tone === "warning"
          ? "alert"
          : tone === "success"
            ? "status"
            : undefined)
      }
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-sm font-medium",
        tone === "info" &&
          "border-[var(--info-line)] bg-[var(--info-soft)] text-[var(--info)]",
        tone === "success" &&
          "border-[var(--good-line)] bg-[var(--good-soft)] text-[var(--good)]",
        tone === "warning" &&
          "border-[var(--warn-line)] bg-[var(--warn-soft)] text-[var(--warn)]",
        tone === "danger" &&
          "border-[var(--danger-line)] bg-[var(--danger-soft)] text-[var(--danger)]",
        className,
      )}
      {...props}
    >
      <span className="mt-0.5 shrink-0">{icon ?? defaultIcon}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}
