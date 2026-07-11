import { type FormEvent, useState } from "react";
import type { AdminSession } from "../../api";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Input, Label } from "../../components/ui/form";
import { interpolate, useI18n } from "../../i18n";
import { formatDateTime } from "../../lib/format";
import { EmptyState, Section } from "./AdminDialogUi";

export function SecurityPanel({
  sessions,
  busyAction,
  onPasswordChange,
  onRevokeSession,
  onRevokeOthers,
}: {
  sessions: AdminSession[];
  busyAction: string | null;
  onPasswordChange: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<boolean>;
  onRevokeSession: (sessionId: string) => void;
  onRevokeOthers: () => void;
}) {
  const { messages: t, localeInfo } = useI18n();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (newPassword.length < 12) {
      setFormError(t.admin.security.minPassword);
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError(t.admin.security.mismatch);
      return;
    }
    const changed = await onPasswordChange(currentPassword, newPassword);
    if (!changed) return;
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <Section
        title={t.admin.security.passwordTitle}
        description={t.admin.security.passwordDescription}
      >
        <form className="grid gap-3" onSubmit={(event) => void submit(event)}>
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <Label>
            {t.admin.security.currentPassword}
            <Input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </Label>
          <Label>
            {t.admin.security.newPassword}
            <Input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </Label>
          <Label>
            {t.admin.security.repeatPassword}
            <Input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </Label>
          <Button
            type="submit"
            variant="primary"
            disabled={busyAction === "password"}
          >
            {busyAction === "password"
              ? t.common.saving
              : t.admin.security.changePassword}
          </Button>
        </form>
      </Section>

      <Section
        title={t.admin.security.sessionsTitle}
        description={t.admin.security.sessionsDescription}
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={onRevokeOthers}
            disabled={
              sessions.filter((session) => !session.current).length === 0 ||
              busyAction === "sessions-others"
            }
          >
            {t.admin.security.logoutOthers}
          </Button>
        }
      >
        <div className="grid max-h-[360px] gap-2 overflow-auto pr-1">
          {sessions.length === 0 ? (
            <EmptyState title={t.admin.security.noSessionsTitle}>
              {t.admin.security.noSessionsBody}
            </EmptyState>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                className="grid gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <strong className="truncate text-sm">
                      {session.current
                        ? t.admin.security.currentSession
                        : t.admin.security.adminSession}
                    </strong>
                    {session.current ? (
                      <span className="rounded-full bg-[var(--good-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--good)]">
                        {t.common.active}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {interpolate(t.admin.security.lastSeenValidUntil, {
                      lastSeen: formatDateTime(
                        session.lastSeenAt,
                        localeInfo.dateLocale,
                      ),
                      expires: formatDateTime(
                        session.expiresAt,
                        localeInfo.dateLocale,
                      ),
                    })}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={
                    session.current || busyAction === `session-${session.id}`
                  }
                  onClick={() => onRevokeSession(session.id)}
                >
                  {t.admin.security.logout}
                </Button>
              </div>
            ))
          )}
        </div>
      </Section>
    </div>
  );
}
