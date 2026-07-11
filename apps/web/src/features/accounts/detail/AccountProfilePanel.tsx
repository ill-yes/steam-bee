import { useId, useRef } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import type { DesiredState } from "@steam-bee/contracts";
import type { Account } from "../../../api";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { formatTokenDate } from "../../../lib/format";
import { desiredLabel } from "../../../lib/status";
import { useI18n, type Messages } from "../../../i18n";
import { AccountAvatar } from "../AccountAvatar";
import { StatusBadge } from "../StatusIndicators";

export function AccountProfilePanel({ account }: { account: Account }) {
  const { messages: t, localeInfo } = useI18n();
  const steamIdFieldId = useId();
  const steamIdFieldRef = useRef<HTMLInputElement>(null);

  return (
    <section className="grid min-w-0 gap-4 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-4">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[var(--muted)]">
            {t.accountDetail.profileTitle}
          </p>
          <h2 className="mt-1 truncate text-3xl font-semibold">
            {account.accountName}
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusBadge status={account.runtimeStatus} />
            <Badge tone="neutral">
              {formatTokenDate(account.tokenExpiresAt, t, localeInfo)}
            </Badge>
          </div>
        </div>
        <AccountAvatar account={account} size="hero" />
      </div>

      <dl className="grid gap-3 border-t border-[var(--line)] pt-4 text-sm text-[var(--muted)]">
        <div>
          <dt className="font-semibold text-[var(--muted-strong)]">SteamID:</dt>
          <dd className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] overflow-hidden rounded-md border border-[var(--line)] bg-[var(--surface)]">
            <input
              id={steamIdFieldId}
              ref={steamIdFieldRef}
              readOnly
              value={account.steamId ?? t.accountDetail.steamIdUnknown}
              className="min-w-0 truncate bg-transparent px-2.5 py-2 text-xs font-mono text-[var(--muted-strong)] outline-none"
              aria-label="SteamID"
              title={account.steamId ?? t.accountDetail.steamIdUnknown}
            />
            <Button
              variant="ghost"
              size="icon"
              disabled={!account.steamId}
              onClick={() =>
                void copySteamId(account.steamId, t, steamIdFieldRef.current)
              }
              aria-label={t.accountDetail.copySteamId}
              title={t.accountDetail.copySteamId}
              className="h-8 w-8 rounded-none border-l border-[var(--line)]"
            >
              <Copy size={14} />
            </Button>
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-[var(--muted-strong)]">
            {t.accountDetail.autostart}
          </dt>
          <dd className="mt-1 leading-5">
            {autostartCopy(account.desiredState, t)}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function autostartCopy(desiredState: DesiredState, messages: Messages) {
  return (
    messages.status.desiredDescription[desiredState] ??
    desiredLabel(desiredState, messages)
  );
}

async function copySteamId(
  steamId: string | null,
  messages: Messages,
  field: HTMLInputElement | null,
) {
  if (!steamId) return;
  const copy = messages.accountDetail;
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard API unavailable");
    }
    await navigator.clipboard.writeText(steamId);
    toast.success(copy.copiedSteamId);
  } catch {
    try {
      const input = document.createElement("textarea");
      input.value = steamId;
      input.setAttribute("readonly", "true");
      input.style.position = "fixed";
      input.style.left = "-9999px";
      document.body.append(input);
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      if (!copied) throw new Error("execCommand copy failed");
      toast.success(copy.copiedSteamId);
    } catch {
      if (field) {
        field.focus();
        field.select();
        toast.info(copy.selectedSteamId);
        return;
      }
      toast.error(copy.copySteamIdFailed);
    }
  }
}
