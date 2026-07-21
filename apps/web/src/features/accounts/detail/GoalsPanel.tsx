import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { PlaytimeGoal, SteamApp } from "../../../api";
import { Button } from "../../../components/ui/button";
import { Input, Select } from "../../../components/ui/form";
import { interpolate, useI18n } from "../../../i18n";
import type { ResourceLoadState } from "../useAccountController";

export function GoalsPanel({
  goals,
  loadState = "ready",
  library,
  busy,
  onSave,
  onDelete,
}: {
  goals: PlaytimeGoal[];
  loadState?: ResourceLoadState;
  library: SteamApp[];
  busy: boolean;
  onSave: (appId: number, targetMinutes: number) => void;
  onDelete: (goal: PlaytimeGoal) => void;
}) {
  const { messages: t, localeInfo } = useI18n();
  const o = t.operations;
  const [appId, setAppId] = useState("");
  const [targetHours, setTargetHours] = useState("");

  return (
    <section className="grid gap-2 border-t border-[var(--line)] pt-3">
      <div>
        <strong className="text-xs text-[var(--muted-strong)]">
          {o.goalsTitle}
        </strong>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
          {o.goalsDescription}
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_90px_auto]">
        <Select
          value={appId}
          onChange={(event) => setAppId(event.target.value)}
          aria-label={o.chooseGame}
        >
          <option value="">{o.chooseGame}</option>
          {library.map((app) => (
            <option key={app.appId} value={app.appId}>
              {app.name}
            </option>
          ))}
        </Select>
        <Input
          type="number"
          min={1}
          value={targetHours}
          onChange={(event) => setTargetHours(event.target.value)}
          placeholder={o.targetHours}
          aria-label={o.targetHours}
        />
        <Button
          size="sm"
          disabled={busy || !appId || Number(targetHours) <= 0}
          onClick={() => {
            onSave(Number(appId), Math.round(Number(targetHours) * 60));
            setTargetHours("");
          }}
        >
          {o.saveGoal}
        </Button>
      </div>
      <div className="grid gap-2">
        {loadState === "loading" ? (
          <p role="status" className="text-xs text-[var(--muted)]">
            {o.loading}
          </p>
        ) : loadState === "error" ? (
          <p role="alert" className="text-xs text-[var(--danger)]">
            {o.failed}
          </p>
        ) : null}
        {goals.map((goal) => (
          <div
            key={goal.id}
            className="rounded-md bg-[var(--surface-2)] p-2 text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">
                <strong>{goal.appName}</strong> ·{" "}
                {Math.round(goal.currentMinutes / 60)} /{" "}
                {Math.round(goal.targetMinutes / 60)} h
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => onDelete(goal)}
                aria-label={`${o.deleteGoal}: ${goal.appName}`}
              >
                <Trash2 size={13} />
              </Button>
            </div>
            <progress
              className="mt-1 h-1.5 w-full"
              max={100}
              value={goal.progressPercent}
              aria-label={`${goal.appName}: ${goal.progressPercent}%`}
            >
              {goal.progressPercent}%
            </progress>
            <p className="text-[10px] text-[var(--muted)]">
              {goal.snapshotImportedAt
                ? interpolate(o.snapshotAt, {
                    date: new Intl.DateTimeFormat(localeInfo.dateLocale, {
                      dateStyle: "short",
                      timeStyle: "short",
                    }).format(goal.snapshotImportedAt),
                  })
                : o.never}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
