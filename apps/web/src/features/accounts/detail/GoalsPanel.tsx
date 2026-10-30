import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { PlaytimeGoal, SteamApp } from "../../../api";
import { Button } from "../../../components/ui/button";
import { Input, Select } from "../../../components/ui/form";
import { interpolate, useI18n } from "../../../i18n";
import type { ResourceLoadState } from "../useAccountController";
import { automationCopy } from "./automationCopy";

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
  const { messages: t, localeInfo, locale } = useI18n();
  const o = t.operations;
  const c = automationCopy(locale);
  const [appId, setAppId] = useState("");
  const [targetHours, setTargetHours] = useState("");

  return (
    <section className="grid gap-3">
      <div>
        <h3 className="text-sm font-semibold">{o.goalsTitle}</h3>
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
          <div key={goal.id} className="grid gap-1.5 text-sm">
            <div className="flex items-center gap-2">
              <strong className="min-w-0 flex-1 truncate">
                {goal.appName}
              </strong>
              <span
                className={
                  goal.reached
                    ? "shrink-0 text-xs font-bold text-[var(--good)]"
                    : "shrink-0 text-xs text-[var(--muted)]"
                }
              >
                {goal.reached ? `${c.goalReached} · ` : ""}
                {interpolate(c.goalProgress, {
                  current: Math.round(goal.currentMinutes / 60),
                  target: Math.round(goal.targetMinutes / 60),
                })}
              </span>
              <Button
                size="icon"
                variant="ghost"
                disabled={busy}
                onClick={() => onDelete(goal)}
                aria-label={`${o.deleteGoal}: ${goal.appName}`}
              >
                <Trash2 size={13} aria-hidden="true" />
              </Button>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(100, goal.progressPercent)}
              aria-label={`${goal.appName}: ${goal.progressPercent}%`}
              className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]"
            >
              <div
                className={
                  goal.reached
                    ? "h-full rounded-full bg-[var(--good)]"
                    : "h-full rounded-full bg-[var(--accent)]"
                }
                style={{ width: `${Math.min(100, goal.progressPercent)}%` }}
              />
            </div>
            <p className="text-xs text-[var(--muted)]">
              {goal.reached
                ? null
                : `${interpolate(c.goalLeft, {
                    hours: Math.max(
                      0,
                      Math.round(
                        (goal.targetMinutes - goal.currentMinutes) / 60,
                      ),
                    ),
                  })} · `}
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
