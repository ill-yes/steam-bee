import { Button } from "./button";
import { Dialog } from "./dialog";

export function ConfirmationDialog({
  title,
  description,
  confirmLabel,
  cancelLabel,
  busyLabel,
  busy = false,
  destructive = true,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  busyLabel?: string;
  busy?: boolean;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}) {
  return (
    <Dialog
      title={title}
      description={description}
      onClose={busy ? () => undefined : onCancel}
      role="alertdialog"
      className="max-w-md border-[var(--danger-line)]"
    >
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button
          variant={destructive ? "danger" : "primary"}
          onClick={() => void onConfirm()}
          disabled={busy}
        >
          {busy ? (busyLabel ?? confirmLabel) : confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
