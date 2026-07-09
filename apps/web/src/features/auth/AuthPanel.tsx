import { useState } from "react";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Input, Label } from "../../components/ui/form";
import { useI18n } from "../../i18n";
import { apiErrorMessage } from "../../api";

export function AuthPanel({
  title,
  description,
  submitLabel,
  setupTokenRequired = false,
  onSubmit,
}: {
  title: string;
  description: string;
  submitLabel: string;
  setupTokenRequired?: boolean;
  onSubmit: (password: string, setupToken: string) => Promise<void>;
}) {
  const { messages: t } = useI18n();
  const [password, setPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <main className="mx-auto grid min-h-[calc(100vh-4rem)] w-[min(980px,calc(100vw-2rem))] items-center gap-5 py-8 lg:grid-cols-[minmax(0,1fr)_420px]">
      <section className="min-w-0">
        <span className="grid h-12 w-12 place-items-center rounded-md border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent-ink)]">
          <ShieldCheck size={24} />
        </span>
        <h2 className="mt-5 max-w-xl text-3xl font-semibold leading-tight">
          {t.auth.heroTitle}
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--muted-strong)]">
          {t.auth.heroDescription}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {t.auth.chips.map((item) => (
            <span
              key={item}
              className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--muted-strong)]"
            >
              {item}
            </span>
          ))}
        </div>
      </section>

      <Card>
        <form
          className="grid gap-4 p-5"
          onSubmit={async (event) => {
            event.preventDefault();
            setLoading(true);
            setError(null);
            try {
              await onSubmit(password, setupToken);
            } catch (submitError) {
              setError(apiErrorMessage(submitError, t));
            } finally {
              setLoading(false);
            }
          }}
        >
          <div className="flex items-start gap-3">
            <LockKeyhole
              size={20}
              className="mt-1 shrink-0 text-[var(--info)]"
            />
            <div>
              <h2 className="text-lg font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">{description}</p>
            </div>
          </div>
          <input
            className="sr-only"
            name="username"
            autoComplete="username"
            value="admin"
            readOnly
            tabIndex={-1}
            aria-hidden="true"
          />
          {setupTokenRequired ? (
            <Label htmlFor="setup-token">
              {t.auth.setupToken}
              <Input
                id="setup-token"
                name="setupToken"
                type="password"
                autoComplete="one-time-code"
                value={setupToken}
                onChange={(event) => setSetupToken(event.target.value)}
                required
              />
              <span className="text-xs font-normal text-[var(--muted)]">
                {t.auth.setupTokenHint}
              </span>
            </Label>
          ) : null}
          <Label htmlFor="admin-password">
            {t.common.password}
            <Input
              id="admin-password"
              name="password"
              type="password"
              autoComplete={
                submitLabel === t.common.save
                  ? "new-password"
                  : "current-password"
              }
              minLength={12}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Label>
          <p className="text-xs text-[var(--muted)]">{t.auth.minPassword}</p>
          {error && <Alert tone="danger">{error}</Alert>}
          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={
              loading ||
              password.length < 12 ||
              (setupTokenRequired && setupToken.length === 0)
            }
          >
            {loading ? t.common.pleaseWait : submitLabel}
          </Button>
        </form>
      </Card>
    </main>
  );
}
