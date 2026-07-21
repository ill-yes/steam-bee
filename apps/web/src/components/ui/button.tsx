import type { ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border px-3 text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:pointer-events-none disabled:opacity-50 max-sm:min-h-11",
  {
    variants: {
      variant: {
        primary:
          "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-fg)] shadow-[var(--button-shadow)] hover:bg-[var(--primary-hover)]",
        secondary:
          "border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-3)]",
        ghost:
          "border-transparent bg-transparent text-[var(--muted-strong)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]",
        danger:
          "border-[var(--danger-line)] bg-[var(--danger-soft)] text-[var(--danger)] hover:bg-[var(--danger-soft-strong)]",
        outline:
          "border-[var(--line-strong)] bg-transparent text-[var(--ink)] hover:bg-[var(--surface-2)]",
      },
      size: {
        sm: "min-h-8 px-2.5 text-xs",
        md: "min-h-9 px-3 text-sm",
        lg: "min-h-10 px-4 text-sm",
        icon: "h-9 w-9 px-0 max-sm:h-11 max-sm:w-11",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
