import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useI18n } from "../../i18n";

export function ToolTabs<T extends string>({
  label,
  items,
  value,
  onChange,
  children,
}: {
  label: string;
  items: readonly { id: T; label: string; count?: number | undefined }[];
  value: T;
  onChange: (value: T) => void;
  children: ReactNode;
}) {
  const id = useId();
  const { localeInfo } = useI18n();
  const buttons = useRef(new Map<T, HTMLButtonElement>());
  const active = items.find((item) => item.id === value) ?? items[0];
  if (!active) return null;

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const direction =
        (event.key === "ArrowRight" ? 1 : -1) *
        (localeInfo.dir === "rtl" ? -1 : 1);
      next = (index + direction + items.length) % items.length;
    } else return;
    event.preventDefault();
    const target = items[next]!;
    onChange(target.id);
    buttons.current.get(target.id)?.focus();
  }

  return (
    <div className="grid min-w-0 gap-4">
      <div
        role="tablist"
        aria-label={label}
        aria-orientation="horizontal"
        className="flex min-w-0 flex-wrap gap-1 border-b border-[var(--line)] pb-1"
      >
        {items.map((item, index) => (
          <button
            key={item.id}
            id={`${id}-${item.id}`}
            type="button"
            role="tab"
            aria-label={
              item.count === undefined
                ? item.label
                : `${item.label} ${item.count}`
            }
            aria-selected={active.id === item.id}
            aria-controls={`${id}-panel`}
            tabIndex={active.id === item.id ? 0 : -1}
            ref={(node) => {
              if (node) buttons.current.set(item.id, node);
              else buttons.current.delete(item.id);
            }}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => navigate(event, index)}
            className={`flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-md px-2 py-2 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)] sm:px-3 sm:text-sm ${active.id === item.id ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-[var(--muted-strong)] hover:bg-[var(--surface-2)]"}`}
          >
            <span className="break-words">{item.label}</span>
            {item.count !== undefined ? (
              <span className="hidden rounded-full border border-current/20 px-1.5 text-xs tabular-nums sm:inline-flex">
                {" "}
                {item.count}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-${active.id}`}
        tabIndex={0}
        className="min-w-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        {children}
      </div>
    </div>
  );
}
