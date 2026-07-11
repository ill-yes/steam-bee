import { Clock3, KeyRound, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useI18n } from "../../i18n";

export function QrLoginPanel({
  started,
  dataUrl,
  loading,
  onStart,
}: {
  started: boolean;
  dataUrl: string | null;
  loading: boolean;
  onStart: () => void;
}) {
  const { messages: t } = useI18n();

  return (
    <section className="grid gap-4 md:grid-cols-[minmax(0,1fr)_230px]">
      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-4">
        <h3 className="text-sm font-semibold">{t.common.scanQr}</h3>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          {t.addAccount.qrIntro}
        </p>
        <Button
          className="mt-4"
          variant="primary"
          onClick={onStart}
          disabled={loading}
        >
          <RefreshCw size={16} />
          {loading ? t.addAccount.qrStarting : t.addAccount.qrStart}
        </Button>
      </div>
      <div className="grid min-h-[230px] place-items-center rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-4">
        {started ? (
          <div className="grid justify-items-center gap-3">
            {dataUrl ? (
              <img
                alt="Steam QR"
                src={dataUrl}
                className="rounded-md bg-white p-2"
              />
            ) : (
              <div className="h-[196px] w-[196px] animate-pulse rounded-md bg-[var(--surface-3)]" />
            )}
            <span className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--muted-strong)]">
              <Clock3 size={15} />
              {t.addAccount.qrWaiting}
            </span>
          </div>
        ) : (
          <div className="grid justify-items-center gap-2 text-center text-sm text-[var(--muted)]">
            <KeyRound size={24} />
            <span>{t.addAccount.qrNotStarted}</span>
          </div>
        )}
      </div>
    </section>
  );
}
