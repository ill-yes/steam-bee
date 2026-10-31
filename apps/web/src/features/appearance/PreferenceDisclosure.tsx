import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** A nonmodal disclosure: native form navigation, Escape, and outside dismissal. */
export function PreferenceDisclosure({
  label,
  trigger,
  className,
  summaryClassName,
  children,
}: {
  label: string;
  trigger: ReactNode;
  className: string;
  summaryClassName: string;
  children: ReactNode;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !details.current?.contains(event.target)
      ) {
        if (details.current) details.current.open = false;
        setOpen(false);
      }
    };
    // Close a disclosure when its trigger disappears at the desktop breakpoint.
    const breakpoint = window.matchMedia?.("(min-width: 1024px)");
    const closeOnLayoutChange = () => {
      if (details.current) details.current.open = false;
      setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    breakpoint?.addEventListener("change", closeOnLayoutChange);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      breakpoint?.removeEventListener("change", closeOnLayoutChange);
    };
  }, [open]);

  return (
    <details
      ref={details}
      className={className}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          event.currentTarget.open = false;
          setOpen(false);
        }
      }}
      onKeyDown={(event) => {
        if (
          event.key !== "Escape" ||
          !details.current?.open ||
          event.defaultPrevented
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        details.current.open = false;
        setOpen(false);
        summary.current?.focus();
      }}
    >
      <summary
        ref={summary}
        className={summaryClassName}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={(event) => {
          event.preventDefault();
          setOpen((value) => !value);
        }}
      >
        {trigger}
      </summary>
      <div
        id={panelId}
        className="fixed inset-x-4 top-16 z-40 mt-2 grid max-h-[calc(100dvh-5rem)] gap-3 overflow-y-auto rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 shadow-[var(--modal-shadow)] sm:absolute sm:inset-x-auto sm:inset-e-0 sm:top-full sm:w-[280px]"
      >
        {children}
      </div>
    </details>
  );
}
