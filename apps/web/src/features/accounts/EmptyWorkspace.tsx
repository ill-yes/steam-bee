import { Gauge, KeyRound, Library, ShieldCheck } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useI18n } from "../../i18n";

export function EmptyWorkspace({ onAdd }: { onAdd: () => void }) {
  const { messages: t } = useI18n();

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(300px,0.95fr)]">
      <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[var(--panel-shadow)]">
        <span className="grid h-12 w-12 place-items-center rounded-md border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent-ink)]">
          <KeyRound size={22} />
        </span>
        <h2 className="mt-5 max-w-xl text-2xl font-semibold">
          {t.emptyWorkspace.title}
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--muted-strong)]">
          {t.emptyWorkspace.body}
        </p>
        <Button className="mt-5" variant="primary" onClick={onAdd}>
          <KeyRound size={16} />
          {t.common.addAccount}
        </Button>
      </section>

      <section className="grid content-start gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--panel-shadow)]">
        <OnboardingItem
          icon={<ShieldCheck size={17} />}
          title={t.emptyWorkspace.qrTitle}
          body={t.emptyWorkspace.qrBody}
        />
        <OnboardingItem
          icon={<Library size={17} />}
          title={t.emptyWorkspace.libraryTitle}
          body={t.emptyWorkspace.libraryBody}
        />
        <OnboardingItem
          icon={<Gauge size={17} />}
          title={t.emptyWorkspace.clientsTitle}
          body={t.emptyWorkspace.clientsBody}
        />
      </section>
    </div>
  );
}

function OnboardingItem({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="grid grid-cols-[34px_minmax(0,1fr)] gap-3 rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-3">
      <span className="grid h-8 w-8 place-items-center rounded-md bg-[var(--surface)] text-[var(--info)]">
        {icon}
      </span>
      <div className="min-w-0">
        <strong className="text-sm">{title}</strong>
        <p className="mt-1 text-sm leading-5 text-[var(--muted)]">{body}</p>
      </div>
    </div>
  );
}
