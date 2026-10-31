import { useEffect, useId, useRef, useState } from "react";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Input, Label } from "../../components/ui/form";
import { interpolate } from "../../i18n";
import { parseDraftIds } from "./drafts";
import type { useFarmingPanel } from "./useFarmingPanel";

/** The rules dialog: limits, protection and AppID lists. Single games are chosen on the board. */
export function FarmingSettings({
  state,
  onSaved,
}: {
  state: ReturnType<typeof useFarmingPanel>;
  onSaved: () => void;
}) {
  const {
    t,
    snapshot,
    draft,
    dirty,
    errors,
    error,
    busy,
    edit,
    discard,
    action,
  } = state;
  const id = useId();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const settingsForm = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (
      errors.whitelist ||
      errors.blacklist ||
      parseDraftIds(draft.whitelist) === null ||
      parseDraftIds(draft.blacklist) === null
    )
      setAdvancedOpen(true);
  }, [errors, draft.whitelist, draft.blacklist]);
  useEffect(() => {
    const invalid = settingsForm.current?.querySelector<HTMLInputElement>(
      '[aria-invalid="true"]',
    );
    invalid?.focus();
    invalid?.scrollIntoView?.({ block: "center" });
  }, [errors, advancedOpen]);
  if (!snapshot) return null;
  return (
    <div className="grid min-w-0 gap-3">
      <form
        ref={settingsForm}
        aria-label={t.settings}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void action("config").then((saved) => {
            if (saved) onSaved();
          });
        }}
      >
        <fieldset
          disabled={Boolean(busy)}
          className="grid min-w-0 gap-3 sm:grid-cols-2"
          aria-describedby={`${id}-config-hint`}
        >
          <legend className="mb-2 text-xs font-semibold text-[var(--muted-strong)]">
            {t.settings}
          </legend>
          <Label className="min-w-0">
            {t.max}
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={32}
              step={1}
              value={draft.maxConcurrentGames}
              onChange={(event) =>
                edit({ maxConcurrentGames: event.target.value })
              }
              aria-invalid={errors.maxConcurrentGames ? true : undefined}
              aria-describedby={
                errors.maxConcurrentGames
                  ? `${id}-limit-error`
                  : `${id}-limit-hint`
              }
            />
            {errors.maxConcurrentGames && (
              <span
                id={`${id}-limit-error`}
                role="alert"
                className="text-[var(--danger)]"
              >
                {errors.maxConcurrentGames}
              </span>
            )}
          </Label>
          <div className="grid min-w-0 content-center gap-2 text-xs">
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                className="shrink-0"
                checked={draft.skipRefundable}
                onChange={(event) =>
                  edit({ skipRefundable: event.target.checked })
                }
                aria-describedby={`${id}-protection`}
              />
              {t.protect}
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                className="shrink-0"
                checked={draft.autoResume}
                onChange={(event) => edit({ autoResume: event.target.checked })}
              />
              {t.autoResume}
            </label>
          </div>
        </fieldset>
        <details
          className="mt-3 rounded-md border border-[var(--line)] px-3 py-2"
          open={advancedOpen}
          onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
        >
          <summary className="min-h-9 cursor-pointer content-center text-xs font-semibold text-[var(--muted-strong)]">
            {t.advancedIds}
          </summary>
          <fieldset
            disabled={Boolean(busy)}
            className="mt-2 grid min-w-0 gap-3 sm:grid-cols-2"
          >
            <legend className="sr-only">{t.advancedIds}</legend>
            <Label className="min-w-0">
              {t.whitelist}
              <Input
                value={draft.whitelist}
                placeholder="730, 440"
                onChange={(event) => edit({ whitelist: event.target.value })}
                aria-invalid={errors.whitelist ? true : undefined}
                aria-describedby={`${id}-ids-hint${errors.whitelist ? ` ${id}-whitelist-error` : ""}`}
              />
              {errors.whitelist && (
                <span
                  id={`${id}-whitelist-error`}
                  role="alert"
                  className="text-[var(--danger)]"
                >
                  {errors.whitelist}
                </span>
              )}
            </Label>
            <Label className="min-w-0">
              {t.blacklist}
              <Input
                value={draft.blacklist}
                placeholder="570"
                onChange={(event) => edit({ blacklist: event.target.value })}
                aria-invalid={errors.blacklist ? true : undefined}
                aria-describedby={`${id}-ids-hint${errors.blacklist ? ` ${id}-blacklist-error` : ""}`}
              />
              {errors.blacklist && (
                <span
                  id={`${id}-blacklist-error`}
                  role="alert"
                  className="text-[var(--danger)]"
                >
                  {errors.blacklist}
                </span>
              )}
            </Label>
          </fieldset>
        </details>
        <div
          id={`${id}-config-hint`}
          className="mt-3 grid gap-2 text-xs leading-5 text-[var(--muted)]"
        >
          <p id={`${id}-ids-hint`}>{t.idsHint}</p>
          <p id={`${id}-protection`}>{t.protection}</p>
          <p id={`${id}-limit-hint`}>
            {interpolate(t.limitHint, { limit: snapshot.gameLimit })}
          </p>
        </div>
        <div className="mt-4 grid gap-2 border-t border-[var(--line)] pt-3">
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <p className="me-auto text-xs text-[var(--muted)]">
              {dirty ? t.pendingChanges : t.savedState}
            </p>
            {dirty && (
              <Button
                variant="ghost"
                className="whitespace-normal"
                disabled={Boolean(busy)}
                onClick={discard}
              >
                {t.discard}
              </Button>
            )}
            <Button
              type="submit"
              variant="primary"
              className="whitespace-normal"
              disabled={Boolean(busy) || !dirty}
            >
              {busy === "config" ? t.progress.config : t.save}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
