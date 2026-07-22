import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ label: ReactNode; value: T }>;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-grid min-h-9 grid-flow-col rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-1 max-sm:min-h-11",
        className,
      )}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cn(
            "rounded-[5px] px-3 text-xs font-semibold text-[var(--muted-strong)] transition hover:text-[var(--ink)] max-sm:min-h-11",
            value === option.value &&
              "bg-[var(--surface)] text-[var(--ink)] shadow-sm",
          )}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
