import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { forwardRef } from "react";
import { cn } from "../../lib/utils";

export function Label({
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "grid gap-1.5 text-xs font-semibold text-[var(--muted-strong)]",
        className,
      )}
      {...props}
    />
  );
}

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "min-h-9 w-full rounded-md border border-[var(--line-strong)] bg-[var(--input)] px-3 text-sm text-[var(--ink)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring-soft)]",
        className,
      )}
      {...props}
    />
  );
});

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "min-h-9 w-full appearance-none rounded-md border border-[var(--line-strong)] bg-[var(--input)] px-3 pr-9 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring-soft)]",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-24 w-full rounded-md border border-[var(--line-strong)] bg-[var(--input)] px-3 py-2 text-sm text-[var(--ink)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring-soft)]",
        className,
      )}
      {...props}
    />
  );
}
