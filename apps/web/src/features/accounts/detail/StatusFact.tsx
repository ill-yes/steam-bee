import { cn } from "../../../lib/utils";

export function StatusFact({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "neutral" | "good" | "warn";
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-md border bg-[var(--surface)] px-3 py-2",
        tone === "neutral" && "border-[var(--line)]",
        tone === "good" && "border-[var(--good-line)]",
        tone === "warn" && "border-[var(--warn-line)]",
      )}
    >
      <span className="block truncate text-xs font-semibold text-[var(--muted)]">
        {label}
      </span>
      <strong className="mt-0.5 block break-words text-sm leading-5">
        {value}
      </strong>
      <small className="mt-0.5 block text-xs leading-5 text-[var(--muted)]">
        {detail}
      </small>
    </div>
  );
}
