import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./button";
import { cn } from "../../lib/utils";
import { useI18n } from "../../i18n";

export function Dialog({
  title,
  description,
  onClose,
  children,
  className,
  role = "dialog",
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  role?: "dialog" | "alertdialog";
}) {
  const { messages: t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    requestAnimationFrame(() => {
      dialog
        .querySelector<HTMLElement>("button, input, select, textarea")
        ?.focus();
    });

    return () => {
      if (dialog.open && typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={cn(
        "m-auto max-h-[calc(100vh-2rem)] w-[min(48rem,calc(100vw-2rem))] overflow-x-hidden overflow-y-auto rounded-lg border border-[var(--line)] bg-[var(--surface)] p-0 text-[var(--ink)] shadow-[var(--modal-shadow)] backdrop:bg-black/65",
        className,
      )}
      role={role}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4">
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="mt-1 text-sm text-[var(--muted)]">
              {description}
            </p>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label={t.common.closeDialog}
        >
          <X size={18} />
        </Button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}
