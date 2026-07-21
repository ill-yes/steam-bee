import { useEffect, useState } from "react";
import type { AccountSafetyPolicy } from "../../../api";
import { Button } from "../../../components/ui/button";
import { Input, Select } from "../../../components/ui/form";
import { interpolate, useI18n } from "../../../i18n";
import type { ResourceLoadState } from "../useAccountController";

export function SafetyPanel({
  policy,
  loadState = "ready",
  busy,
  canPauseUntil,
  onSave,
  onPauseUntil,
}: {
  policy: AccountSafetyPolicy | null;
  loadState?: ResourceLoadState;
  busy: boolean;
  canPauseUntil: boolean;
  onSave: (input: {
    resumePolicy: AccountSafetyPolicy["resumePolicy"];
    resumeDelayMinutes: number;
    maxSessionMinutes: number | null;
    maxDailyMinutes: number | null;
    maxWeeklyMinutes: number | null;
  }) => void;
  onPauseUntil: (until: number) => void;
}) {
  const { messages: t, localeInfo } = useI18n();
  const o = t.operations;
  const [resumePolicy, setResumePolicy] =
    useState<AccountSafetyPolicy["resumePolicy"]>("automatic");
  const [resumeDelay, setResumeDelay] = useState("15");
  const [sessionLimit, setSessionLimit] = useState("");
  const [dailyLimit, setDailyLimit] = useState("");
  const [weeklyLimit, setWeeklyLimit] = useState("");

  useEffect(() => {
    if (!policy) return;
    setResumePolicy(policy.resumePolicy);
    setResumeDelay(String(policy.resumeDelayMinutes));
    setSessionLimit(stringLimit(policy.maxSessionMinutes));
    setDailyLimit(stringLimit(policy.maxDailyMinutes));
    setWeeklyLimit(stringLimit(policy.maxWeeklyMinutes));
  }, [policy]);

  const resumeDelayMinutes =
    resumePolicy === "delayed"
      ? parseRequiredMinutes(resumeDelay, 1, 24 * 60)
      : (policy?.resumeDelayMinutes ?? 15);
  const maxSessionMinutes = parseLimit(sessionLimit);
  const maxDailyMinutes = parseLimit(dailyLimit);
  const maxWeeklyMinutes = parseLimit(weeklyLimit);
  const inputsValid =
    resumeDelayMinutes !== null &&
    maxSessionMinutes !== undefined &&
    maxDailyMinutes !== undefined &&
    maxWeeklyMinutes !== undefined;

  return (
    <section className="grid gap-3">
      <div>
        <h3 className="text-sm font-semibold">{o.safetyTitle}</h3>
        <p className="mt-0.5 text-xs leading-5 text-[var(--muted)]">
          {o.safetyDescription}
        </p>
      </div>
      {loadState === "loading" ? (
        <p role="status" className="text-xs text-[var(--muted)]">
          {o.loading}
        </p>
      ) : loadState === "error" ? (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {o.failed}
        </p>
      ) : null}
      {policy?.holdReason ? (
        <div className="rounded-md border border-[var(--warn-line)] bg-[var(--warn-soft)] p-2 text-xs text-[var(--warn)]">
          {interpolate(o.activeHold, {
            reason: o.holdReasons[policy.holdReason],
          })}{" "}
          {policy.pauseUntil
            ? interpolate(o.holdUntil, {
                date: new Intl.DateTimeFormat(localeInfo.dateLocale, {
                  dateStyle: "short",
                  timeStyle: "short",
                }).format(policy.pauseUntil),
              })
            : null}
        </div>
      ) : null}
      <label className="grid gap-1 text-xs font-semibold text-[var(--muted-strong)]">
        {o.resumePolicy}
        <Select
          value={resumePolicy}
          onChange={(event) =>
            setResumePolicy(
              event.target.value as AccountSafetyPolicy["resumePolicy"],
            )
          }
        >
          <option value="automatic">{o.resumeAutomatic}</option>
          <option value="delayed">{o.resumeDelayed}</option>
          <option value="manual">{o.resumeManual}</option>
        </Select>
      </label>
      {resumePolicy === "delayed" ? (
        <NumberField
          label={o.resumeDelay}
          value={resumeDelay}
          onChange={setResumeDelay}
          min={1}
          max={24 * 60}
          invalid={resumeDelayMinutes === null}
        />
      ) : null}
      <div className="grid gap-2 sm:grid-cols-3">
        <NumberField
          label={o.sessionLimit}
          value={sessionLimit}
          onChange={setSessionLimit}
          min={5}
          max={7 * 24 * 60}
          invalid={maxSessionMinutes === undefined}
        />
        <NumberField
          label={o.dailyLimit}
          value={dailyLimit}
          onChange={setDailyLimit}
          min={5}
          max={7 * 24 * 60}
          invalid={maxDailyMinutes === undefined}
        />
        <NumberField
          label={o.weeklyLimit}
          value={weeklyLimit}
          onChange={setWeeklyLimit}
          min={5}
          max={7 * 24 * 60}
          invalid={maxWeeklyMinutes === undefined}
        />
      </div>
      {!inputsValid ? (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {o.invalidSafetyValue}
        </p>
      ) : null}
      <Button
        size="sm"
        disabled={busy || !policy || !inputsValid}
        onClick={() => {
          if (
            resumeDelayMinutes === null ||
            maxSessionMinutes === undefined ||
            maxDailyMinutes === undefined ||
            maxWeeklyMinutes === undefined
          ) {
            return;
          }
          onSave({
            resumePolicy,
            resumeDelayMinutes,
            maxSessionMinutes,
            maxDailyMinutes,
            maxWeeklyMinutes,
          });
        }}
      >
        {o.saveSafety}
      </Button>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !canPauseUntil}
          onClick={() => onPauseUntil(Date.now() + 60 * 60_000)}
        >
          {o.pauseOneHour}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !canPauseUntil}
          onClick={() => onPauseUntil(Date.now() + 24 * 60 * 60_000)}
        >
          {o.pauseOneDay}
        </Button>
      </div>
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min: number;
  max: number;
  invalid: boolean;
}) {
  return (
    <label className="grid gap-1 text-[11px] font-semibold text-[var(--muted-strong)]">
      {label}
      <Input
        type="number"
        min={min}
        max={max}
        aria-invalid={invalid}
        value={value}
        placeholder="—"
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function parseLimit(value: string) {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 5 && parsed <= 7 * 24 * 60
    ? parsed
    : undefined;
}

function parseRequiredMinutes(value: string, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null;
}

function stringLimit(value: number | null) {
  return value === null ? "" : String(value);
}
