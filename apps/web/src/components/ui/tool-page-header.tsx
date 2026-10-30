import type { ReactNode, Ref } from "react";
import { RefreshCw, type LucideIcon } from "lucide-react";
import { Button, type ButtonProps } from "./button";

export function ToolPageHeader({
  icon: Icon,
  title,
  description,
  actions,
  children,
  titleId,
  titleRef,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  actions?: ReactNode;
  children?: ReactNode;
  titleId?: string | undefined;
  titleRef?: Ref<HTMLHeadingElement> | undefined;
}) {
  return (
    <header className="grid min-w-0 gap-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent-ink)]">
            <Icon size={20} aria-hidden="true" />
          </span>
          <h2
            id={titleId}
            ref={titleRef}
            tabIndex={titleRef ? -1 : undefined}
            className="break-words text-lg font-semibold tracking-tight outline-none sm:text-xl"
          >
            {title}
          </h2>
        </div>
        {actions ? (
          <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
      <p className="max-w-3xl text-xs leading-5 text-[var(--muted)] sm:text-sm">
        {description}
      </p>
      {children}
    </header>
  );
}

export function ToolRefreshButton({
  label,
  busy = false,
  disabled,
  ...props
}: Omit<ButtonProps, "children" | "variant" | "size"> & {
  label: string;
  busy?: boolean | undefined;
}) {
  return (
    <Button
      {...props}
      variant="outline"
      size="sm"
      aria-label={label}
      title={label}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      className="max-sm:w-11 max-sm:px-0"
    >
      <RefreshCw
        size={16}
        aria-hidden="true"
        className={busy ? "animate-spin" : undefined}
      />
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}
