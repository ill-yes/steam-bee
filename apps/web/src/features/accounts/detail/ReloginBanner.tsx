import { KeyRound, QrCode } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { interpolate, useI18n } from "../../../i18n";
import type { LoginMode } from "../useAddAccountFlow";
import { hubCopy } from "./hubCopy";

export function ReloginBanner({
  steamMessage,
  onRelogin,
}: {
  steamMessage?: string | null | undefined;
  onRelogin: (mode: LoginMode) => void;
}) {
  const { locale } = useI18n();
  const copy = hubCopy(locale);
  return (
    <div
      role="alert"
      className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-[var(--warn-line)] bg-[var(--warn-soft)] px-4 py-3"
    >
      <div className="min-w-0 flex-[1_1_380px]">
        <strong className="block text-sm text-[var(--ink)]">
          {copy.reloginBannerTitle}
        </strong>
        <p className="text-sm leading-5 text-[var(--muted-strong)]">
          {copy.reloginBannerText}
        </p>
        {steamMessage ? (
          <p className="mt-1 break-words text-xs text-[var(--muted)]">
            {interpolate(copy.steamMessage, { message: steamMessage })}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          className="min-h-11 lg:min-h-9"
          onClick={() => onRelogin("qr")}
        >
          <QrCode size={15} aria-hidden="true" />
          {copy.reloginQr}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="min-h-11 lg:min-h-9"
          onClick={() => onRelogin("credentials")}
        >
          <KeyRound size={15} aria-hidden="true" />
          {copy.reloginPassword}
        </Button>
      </div>
    </div>
  );
}
