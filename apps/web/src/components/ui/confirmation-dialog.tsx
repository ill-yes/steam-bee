import { Button } from "./button";
import { Dialog } from "./dialog";
import { Alert } from "./alert";

export function ConfirmationDialog({
  title,
  description,
  confirmLabel,
  cancelLabel,
  busyLabel,
  error,
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
  error?: string | null;
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
      className={
        destructive ? "max-w-md border-[var(--danger-line)]" : "max-w-md"
      }
    >
      <div className="grid gap-4">
        {error ? (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        ) : null}
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
      </div>
    </Dialog>
  );
}
