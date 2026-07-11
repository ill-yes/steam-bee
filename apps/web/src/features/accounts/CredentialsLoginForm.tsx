import { KeyRound } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input, Label } from "../../components/ui/form";
import { useI18n } from "../../i18n";
import type { CredentialField, SteamCredentials } from "./useAddAccountFlow";

export function CredentialsLoginForm({
  credentials,
  loading,
  onChange,
  onSubmit,
}: {
  credentials: SteamCredentials;
  loading: boolean;
  onChange: (field: CredentialField, value: string) => void;
  onSubmit: () => Promise<void>;
}) {
  const { messages: t } = useI18n();

  return (
    <form
      className="grid gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit();
      }}
    >
      <div className="flex items-start gap-3">
        <KeyRound size={18} className="mt-1 shrink-0 text-[var(--info)]" />
        <div>
          <h3 className="text-sm font-semibold">
            {t.common.credentialFallback}
          </h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {t.addAccount.credentialsOnlyIfQrFails}
          </p>
        </div>
      </div>
      <Label htmlFor="steam-account-name">
        {t.common.accountName}
        <Input
          id="steam-account-name"
          name="accountName"
          autoComplete="username"
          value={credentials.accountName}
          onChange={(event) => onChange("accountName", event.target.value)}
          required
        />
      </Label>
      <Label htmlFor="steam-password">
        {t.common.password}
        <Input
          id="steam-password"
          name="steam-password"
          type="password"
          autoComplete="current-password"
          value={credentials.password}
          onChange={(event) => onChange("password", event.target.value)}
          required
        />
      </Label>
      <Label htmlFor="steam-guard-code">
        {t.common.steamGuardCode}
        <Input
          id="steam-guard-code"
          name="steamGuardCode"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={credentials.guardCode}
          onChange={(event) => onChange("guardCode", event.target.value)}
        />
      </Label>
      <p className="text-xs text-[var(--muted)]">
        {t.addAccount.credentialsNotPersisted}
      </p>
      <Button
        type="submit"
        variant="primary"
        disabled={loading || !credentials.accountName || !credentials.password}
      >
        {loading
          ? t.addAccount.credentialsConnecting
          : t.addAccount.credentialsConnect}
      </Button>
    </form>
  );
}
