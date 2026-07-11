import { useI18n } from "../../i18n";
import type { LoginStep } from "./useAddAccountFlow";

export function LoginProgress({ step }: { step: LoginStep }) {
  const { messages: t } = useI18n();
  const steps: Array<{ id: Exclude<LoginStep, "idle">; label: string }> = [
    { id: "qr", label: t.addAccount.progress.qr },
    { id: "connecting", label: t.addAccount.progress.connecting },
    { id: "importing", label: t.addAccount.progress.importing },
    { id: "done", label: t.addAccount.progress.done },
  ];
  const activeIndex = Math.max(
    0,
    steps.findIndex((item) => item.id === step),
  );

  return (
    <div
      className="grid gap-2 sm:grid-cols-4"
      aria-label={t.addAccount.progressAria}
    >
      {steps.map((item, index) => {
        const done =
          step !== "idle" && (index < activeIndex || step === "done");
        const active = step !== "idle" && index === activeIndex && !done;
        return (
          <span
            key={item.id}
            className={`flex min-h-9 min-w-0 items-center gap-2 rounded-md border px-2 text-xs font-semibold ${
              done
                ? "border-[var(--good-line)] bg-[var(--good-soft)] text-[var(--good)]"
                : active
                  ? "border-[var(--info-line)] bg-[var(--info-soft)] text-[var(--info)]"
                  : "border-[var(--line)] bg-[var(--surface-2)] text-[var(--muted)]"
            }`}
          >
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--surface)] text-[11px]">
              {index + 1}
            </span>
            <span className="truncate">{item.label}</span>
          </span>
        );
      })}
    </div>
  );
}
