import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex min-h-6 items-center gap-1.5 rounded-full border px-2 text-xs font-semibold",
  {
    variants: {
      tone: {
        neutral:
          "border-[var(--line)] bg-[var(--surface-2)] text-[var(--muted-strong)]",
        good: "border-[var(--good-line)] bg-[var(--good-soft)] text-[var(--good)]",
        info: "border-[var(--info-line)] bg-[var(--info-soft)] text-[var(--info)]",
        warn: "border-[var(--warn-line)] bg-[var(--warn-soft)] text-[var(--warn)]",
        danger:
          "border-[var(--danger-line)] bg-[var(--danger-soft)] text-[var(--danger)]",
        accent:
          "border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent-ink)]",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

export type BadgeProps = HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>;

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
