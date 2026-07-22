import { useEffect, useRef, useState } from "react";
import { Bell, Download, Pause, Square, Trash2 } from "lucide-react";
import type {
  AccountGroup,
  AdminOverview,
  BulkAccountCommandResult,
  NotificationRule,
} from "../../api";
import { api, apiDownload, apiErrorMessage } from "../../api";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { ConfirmationDialog } from "../../components/ui/confirmation-dialog";
import { Input, Label } from "../../components/ui/form";
import { interpolate, useI18n } from "../../i18n";
import {
  defaultBrowserRuleName,
  importantNotificationEventSelectors,
} from "../../notification-rules";
import { EmptyState, Section } from "./AdminDialogUi";

type PendingDeletion = {
  description: string;
  action: () => Promise<boolean>;
};

export function OperationsPanel({
  overview,
  onNotificationRulesChanged,
}: {
  overview: AdminOverview;
  onNotificationRulesChanged: () => Promise<void> | void;
}) {
  const { localeInfo, messages: t } = useI18n();
  const o = t.operations;
  const [groups, setGroups] = useState<AccountGroup[]>([]);
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [groupName, setGroupName] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [webhookName, setWebhookName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [passphraseRepeat, setPassphraseRepeat] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkAccountCommandResult | null>(
    null,
  );
  const [pendingDeletion, setPendingDeletion] =
    useState<PendingDeletion | null>(null);
  const browserEnableInFlight = useRef(false);

  async function load() {
    const [nextGroups, nextRules] = await Promise.all([
      api<AccountGroup[]>("/api/account-groups"),
      api<NotificationRule[]>("/api/notifications/rules"),
    ]);
    setGroups(nextGroups);
    setRules(nextRules);
  }

  useEffect(() => {
    void load().catch((loadError) => setError(apiErrorMessage(loadError, t)));
    const refreshTimer = window.setInterval(() => {
      void load().catch((loadError) => setError(apiErrorMessage(loadError, t)));
    }, 30_000);
    return () => window.clearInterval(refreshTimer);
  }, []);

  async function run(name: string, action: () => Promise<void>) {
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(o.saved);
      return true;
    } catch (requestError) {
      setError(apiErrorMessage(requestError, t));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function createGroup() {
    if (!groupName.trim() || selectedIds.length === 0) return;
    await run("group-create", async () => {
      await api("/api/account-groups", {
        method: "POST",
        body: JSON.stringify({ name: groupName, accountIds: selectedIds }),
      });
      setGroupName("");
      setSelectedIds([]);
      await load();
    });
  }

  async function groupAction(group: AccountGroup, command: "pause" | "stop") {
    await run(`group-${command}-${group.id}`, async () => {
      const result = await api<BulkAccountCommandResult>(
        `/api/account-groups/${group.id}/actions/${command}`,
        { method: "POST" },
      );
      setBulkResult(result);
    });
  }

  async function deleteGroup(group: AccountGroup, confirmed = false) {
    if (!confirmed) {
      setPendingDeletion({
        description: interpolate(o.confirmDeleteGroup, { name: group.name }),
        action: () => deleteGroup(group, true),
      });
      return false;
    }
    return run(`group-delete-${group.id}`, async () => {
      await api(`/api/account-groups/${group.id}`, { method: "DELETE" });
      await load();
    });
  }

  async function enableBrowserNotifications() {
    if (browserEnableInFlight.current) return;
    browserEnableInFlight.current = true;
    try {
      if (!("Notification" in window)) {
        setError(o.browserUnsupported);
        return;
      }
      let permission: NotificationPermission;
      try {
        permission = await window.Notification.requestPermission();
      } catch (permissionError) {
        setError(apiErrorMessage(permissionError, t));
        return;
      }
      if (permission !== "granted") {
        setError(o.permissionDenied);
        return;
      }
      await run("browser-rule", async () => {
        await api("/api/notifications/rules", {
          method: "POST",
          body: JSON.stringify({
            name: defaultBrowserRuleName,
            target: "browser",
            enabled: true,
            eventTypes: importantNotificationEventSelectors,
          }),
        });
        await load();
        await onNotificationRulesChanged();
      });
    } finally {
      browserEnableInFlight.current = false;
    }
  }

  async function createWebhook() {
    if (!webhookName.trim() || !webhookUrl.trim()) return;
    await run("webhook-create", async () => {
      await api("/api/notifications/rules", {
        method: "POST",
        body: JSON.stringify({
          name: webhookName,
          target: "webhook",
          enabled: true,
          eventTypes: importantNotificationEventSelectors,
          webhookUrl,
        }),
      });
      setWebhookName("");
      setWebhookUrl("");
      await load();
      await onNotificationRulesChanged();
    });
  }

  async function deleteRule(rule: NotificationRule, confirmed = false) {
    if (!confirmed) {
      setPendingDeletion({
        description: interpolate(o.confirmDeleteRule, { name: rule.name }),
        action: () => deleteRule(rule, true),
      });
      return false;
    }
    return run(`rule-delete-${rule.id}`, async () => {
      await api(`/api/notifications/rules/${rule.id}`, { method: "DELETE" });
      await load();
      await onNotificationRulesChanged();
    });
  }

  async function downloadBackup() {
    if (passphrase !== passphraseRepeat) {
      setError(o.passphraseMismatch);
      return;
    }
    await run("backup", async () => {
      const download = await apiDownload("/api/admin/backup", {
        method: "POST",
        body: JSON.stringify({ passphrase }),
      });
      const url = URL.createObjectURL(download.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = download.filename ?? "steam-bee-backup.sbb";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setPassphrase("");
      setPassphraseRepeat("");
    });
  }

  return (
    <div className="grid gap-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={o.groupsTitle} description={o.groupsDescription}>
          <div className="grid gap-3">
            <Label>
              {o.groupName}
              <Input
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder={o.groupName}
              />
            </Label>
            <fieldset className="grid gap-2">
              <legend className="text-xs font-semibold text-[var(--muted-strong)]">
                {o.chooseAccounts}
              </legend>
              {overview.accounts.map((account) => (
                <label
                  key={account.id}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(account.id)}
                    onChange={() =>
                      setSelectedIds((current) =>
                        current.includes(account.id)
                          ? current.filter((id) => id !== account.id)
                          : [...current, account.id],
                      )
                    }
                  />
                  <span className="truncate">{account.accountName}</span>
                </label>
              ))}
              {overview.accounts.length === 0 ? (
                <p className="text-xs font-normal text-[var(--muted)]">
                  {o.noAccountsForGroup}
                </p>
              ) : null}
            </fieldset>
            <Button
              size="sm"
              onClick={() => void createGroup()}
              disabled={
                busy !== null || !groupName.trim() || selectedIds.length === 0
              }
            >
              {o.createGroup}
            </Button>
            <div className="grid gap-2" aria-live="polite">
              {groups.length === 0 ? (
                <EmptyState title={o.noGroups}>
                  {o.groupsDescription}
                </EmptyState>
              ) : (
                groups.map((group) => (
                  <div
                    key={group.id}
                    className="rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <strong className="truncate text-sm">{group.name}</strong>
                      <span className="text-xs text-[var(--muted)]">
                        {interpolate(o.selectedAccounts, {
                          count: group.accountIds.length,
                        })}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`${o.pauseGroup}: ${group.name}`}
                        onClick={() => void groupAction(group, "pause")}
                        disabled={busy !== null}
                      >
                        <Pause size={14} /> {o.pauseGroup}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`${o.stopGroup}: ${group.name}`}
                        onClick={() => void groupAction(group, "stop")}
                        disabled={busy !== null}
                      >
                        <Square size={14} /> {o.stopGroup}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void deleteGroup(group)}
                        disabled={busy !== null}
                        aria-label={`${o.deleteGroup}: ${group.name}`}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
            {bulkResult ? (
              <div
                className="rounded-md border border-[var(--line)] p-3 text-xs"
                aria-live="polite"
              >
                <strong>{o.actionResults}</strong>
                <ul className="mt-1 grid gap-1">
                  {bulkResult.results.map((result) => (
                    <li key={result.accountId}>
                      {overview.accounts.find(
                        (account) => account.id === result.accountId,
                      )?.accountName ?? result.accountId}
                      : {result.ok ? o.success : result.error}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Section>

        <Section
          title={o.notificationsTitle}
          description={o.notificationsDescription}
        >
          <div className="grid gap-3">
            <Button
              variant="outline"
              onClick={() => void enableBrowserNotifications()}
              disabled={busy !== null}
            >
              <Bell size={15} /> {o.browserRule}
            </Button>
            <p className="text-xs text-[var(--muted)]">{o.eventTypes}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Label>
                {o.webhookName}
                <Input
                  value={webhookName}
                  onChange={(event) => setWebhookName(event.target.value)}
                  placeholder={o.webhookName}
                />
              </Label>
              <Label>
                {o.webhookUrl}
                <Input
                  value={webhookUrl}
                  onChange={(event) => setWebhookUrl(event.target.value)}
                  placeholder={o.webhookUrl}
                  type="url"
                />
              </Label>
            </div>
            <Button
              size="sm"
              onClick={() => void createWebhook()}
              disabled={
                busy !== null || !webhookName.trim() || !webhookUrl.trim()
              }
            >
              {o.addWebhook}
            </Button>
            <div className="grid gap-2">
              {rules.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">{o.noRules}</p>
              ) : (
                rules.map((rule) => {
                  const displayName =
                    rule.target === "browser" &&
                    rule.name === defaultBrowserRuleName
                      ? o.browserRuleDisplayName
                      : rule.name;
                  return (
                    <div
                      key={rule.id}
                      className="flex items-center justify-between gap-3 rounded-md bg-[var(--surface-2)] p-2 text-sm"
                    >
                      <span className="min-w-0">
                        <strong className="block truncate">
                          {displayName}
                        </strong>
                        <span className="mt-0.5 block text-xs text-[var(--muted)]">
                          {rule.target === "browser" ? o.browser : o.webhook} ·{" "}
                          {o.notificationStates[rule.effectiveStatus]}
                          {rule.failureCount > 0
                            ? ` · ${interpolate(o.notificationFailures, { count: rule.failureCount })}`
                            : ""}
                          {rule.nextRetryAt
                            ? ` · ${interpolate(o.notificationNextRetry, { date: new Date(rule.nextRetryAt).toLocaleString(localeInfo.dateLocale) })}`
                            : ""}
                          {rule.suspendedUntil
                            ? ` · ${interpolate(o.notificationSuspendedUntil, { date: new Date(rule.suspendedUntil).toLocaleString(localeInfo.dateLocale) })}`
                            : ""}
                        </span>
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void deleteRule(rule)}
                        disabled={busy !== null}
                        aria-label={`${o.deleteRule}: ${displayName}`}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </Section>
      </div>

      <Section title={o.backupTitle} description={o.backupDescription}>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-xs font-semibold text-[var(--muted-strong)]">
            {o.passphrase}
            <Input
              type="password"
              autoComplete="new-password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-[var(--muted-strong)]">
            {o.repeatPassphrase}
            <Input
              type="password"
              autoComplete="new-password"
              value={passphraseRepeat}
              onChange={(event) => setPassphraseRepeat(event.target.value)}
            />
          </label>
          <p className="text-xs text-[var(--muted)] md:col-span-2">
            {o.passphraseHint}
          </p>
          <Button
            onClick={() => void downloadBackup()}
            disabled={
              busy !== null ||
              passphrase.length < 12 ||
              passphraseRepeat.length < 12
            }
          >
            <Download size={15} />{" "}
            {busy === "backup" ? o.downloading : o.downloadBackup}
          </Button>
          <p className="text-xs leading-5 text-[var(--muted)]">
            {o.restoreHint}
          </p>
        </div>
      </Section>
      {pendingDeletion ? (
        <ConfirmationDialog
          title={t.common.confirmAction}
          description={pendingDeletion.description}
          confirmLabel={t.common.delete}
          cancelLabel={t.common.cancel}
          busyLabel={t.common.pleaseWait}
          busy={busy !== null}
          error={error}
          onCancel={() => setPendingDeletion(null)}
          onConfirm={async () => {
            if (await pendingDeletion.action()) setPendingDeletion(null);
          }}
        />
      ) : null}
    </div>
  );
}
