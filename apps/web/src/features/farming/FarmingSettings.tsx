import { useEffect, useId, useRef, useState, type Ref } from "react";
import type { SteamApp } from "@steam-bee/contracts";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Input, Label } from "../../components/ui/form";
import { interpolate } from "../../i18n";
import { FarmingGamePicker } from "./FarmingGamePicker";
import { parseDraftIds } from "./drafts";
import type { useFarmingPanel } from "./useFarmingPanel";

export function FarmingSettings({
  accountId,
  library,
  state,
  visible,
  titleRef,
}: {
  accountId: string;
  library?: SteamApp[] | undefined;
  state: ReturnType<typeof useFarmingPanel>;
  visible: boolean;
  titleRef?: Ref<HTMLHeadingElement>;
}) {
  const {
    t,
    snapshot,
    active,
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
    if (!visible) return;
    const invalid = settingsForm.current?.querySelector<HTMLInputElement>(
      '[aria-invalid="true"]',
    );
    invalid?.focus();
    invalid?.scrollIntoView?.({ block: "center" });
  }, [errors, advancedOpen, visible]);
  if (!snapshot) return null;
  return (
    <section className="grid min-w-0 gap-3" aria-labelledby={`${id}-title`}>
      <div>
        <h3
          id={`${id}-title`}
          ref={titleRef}
          tabIndex={-1}
          className="scroll-mt-24 text-sm font-semibold outline-none"
        >
          {t.selectionSettings}
        </h3>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
          {t.workflow}
        </p>
      </div>
      <form
        ref={settingsForm}
        aria-label={t.settings}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void action("config");
        }}
      >
        <div className="sticky top-20 z-10 mb-4 grid gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] p-3 shadow-[var(--panel-shadow)]">
          {error && <Alert tone="danger">{error}</Alert>}
          {dirty ? (
            <>
              <p className="text-xs text-[var(--muted-strong)]">
                {t.pendingChanges}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  variant="primary"
                  className="whitespace-normal"
                  disabled={Boolean(busy) || active}
                >
                  {busy === "config" ? t.progress.config : t.save}
                </Button>
                <Button
                  variant="ghost"
                  className="whitespace-normal"
                  disabled={Boolean(busy) || active}
                  onClick={discard}
                >
                  {t.discard}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-xs text-[var(--muted)]">{t.savedState}</p>
          )}
          {active && (
            <p className="text-xs text-[var(--warn)]">{t.configLocked}</p>
          )}
        </div>
        <fieldset
          disabled={active || Boolean(busy)}
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
          </div>
        </fieldset>
        <div className="mt-3">
          <FarmingGamePicker
            key={accountId}
            accountId={accountId}
            snapshot={snapshot}
            draft={draft}
            library={library}
            disabled={active || Boolean(busy)}
            onChange={edit}
          />
        </div>
        <details
          className="mt-3 rounded-md border border-[var(--line)] px-3 py-2"
          open={advancedOpen}
          onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
        >
          <summary className="min-h-9 cursor-pointer content-center text-xs font-semibold text-[var(--muted-strong)]">
            {t.advancedIds}
          </summary>
          <fieldset
            disabled={active || Boolean(busy)}
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
          {active && <p>{t.configLocked}</p>}
        </div>
      </form>
    </section>
  );
}
