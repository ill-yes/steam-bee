import type { MarketCurrency, MarketPriceSettings } from "@steam-bee/contracts";
import { useEffect, useId, useRef, useState } from "react";
import { Settings2 } from "lucide-react";
import { api, ApiError, apiErrorMessage, isAbortError } from "../../api";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input, Label, Select } from "../../components/ui/form";
import { interpolate, useI18n } from "../../i18n";
import { advancedInventoryCopy } from "./advanced-copy";
import { formatMinorToMajor, parseMajorToMinor } from "./inventory-model";
import {
  readPriceRulesDraft,
  storePriceRulesDraft,
  rulesDraftMatchesSettings,
  type PriceRulesDraft,
} from "./price-rule-draft";

export function PriceRulesPanel({
  accountId,
  currency,
  disabled,
  onEditingChange,
  onSettingsChange,
  embedded = false,
  active = true,
}: {
  accountId: string;
  currency: MarketCurrency | null;
  disabled: boolean;
  onEditingChange: (editing: boolean) => void;
  onSettingsChange?: (settings: MarketPriceSettings) => void;
  embedded?: boolean;
  active?: boolean;
}) {
  const { locale, messages } = useI18n();
  const a = advancedInventoryCopy(locale);
  const contentId = useId();
  const [restored] = useState(() => readPriceRulesDraft(accountId));
  const [dirty, setDirty] = useState(restored !== null);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const draftCurrency = useRef<MarketCurrency | null>(
    restored?.currency ?? currency,
  );
  const [open, setOpen] = useState(false);
  const expanded = embedded || open;
  const [loaded, setLoaded] = useState<MarketPriceSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const [mode, setMode] = useState<MarketPriceSettings["priceMode"]>(
    restored?.priceMode ?? "lowestSellOrder",
  );
  const [adjustment, setAdjustment] = useState(restored?.adjustment ?? "0");
  const [minimum, setMinimum] = useState(restored?.minimum ?? "");
  const [maximum, setMaximum] = useState(restored?.maximum ?? "");
  const [delay, setDelay] = useState(restored?.delay ?? "10");
  const alive = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const currentCurrency = useRef(currency);
  currentCurrency.current = currency;
  const saveLock = useRef(false);
  const base = `/api/accounts/${encodeURIComponent(accountId)}/market/settings`;
  const mismatch =
    loaded?.currencyId != null &&
    currency != null &&
    loaded.currencyId !== currency.id;
  const draftMismatch =
    dirty &&
    draftCurrency.current !== null &&
    currency !== null &&
    draftCurrency.current.id !== currency.id;

  function present(value: MarketPriceSettings) {
    setLoaded(value);
    onSettingsChange?.(value);
    if (dirtyRef.current) return;
    const wallet = currentCurrency.current;
    draftCurrency.current = wallet;
    const sameCurrency =
      value.currencyId === null || value.currencyId === wallet?.id;
    const digits = wallet?.minorUnit ?? 2;
    setMode(value.priceMode);
    setAdjustment(
      sameCurrency
        ? (formatMinorToMajor(value.adjustment, digits) ?? "0")
        : "0",
    );
    setMinimum(
      sameCurrency && value.minBuyerPrice !== null
        ? (formatMinorToMajor(value.minBuyerPrice, digits) ?? "")
        : "",
    );
    setMaximum(
      sameCurrency && value.maxBuyerPrice !== null
        ? (formatMinorToMajor(value.maxBuyerPrice, digits) ?? "")
        : "",
    );
    setDelay(String(value.delaySeconds));
  }
  const message = (cause: unknown) =>
    cause instanceof ApiError && cause.code === "CONFLICT"
      ? cause.message
      : apiErrorMessage(cause, messages);

  function change(values: Partial<PriceRulesDraft>) {
    const next: PriceRulesDraft = {
      priceMode: mode,
      adjustment,
      minimum,
      maximum,
      delay,
      currency: draftCurrency.current ?? currency,
      ...values,
    };
    const changed = !loaded || !rulesDraftMatchesSettings(next, loaded);
    draftCurrency.current = next.currency;
    dirtyRef.current = changed;
    setDirty(changed);
    setNotice("");
    storePriceRulesDraft(accountId, changed ? next : null);
    onEditingChange(changed || saving);
  }
  function discard() {
    if (saving) return;
    dirtyRef.current = false;
    setDirty(false);
    storePriceRulesDraft(accountId, null);
    if (loaded) present(loaded);
    else {
      setMode("lowestSellOrder");
      setAdjustment("0");
      setMinimum("");
      setMaximum("");
      setDelay("10");
      draftCurrency.current = currency;
    }
    setError("");
    setNotice("");
    onEditingChange(false);
  }
  useEffect(() => {
    onEditingChange(dirty || saving);
  }, [dirty, saving, onEditingChange]);
  useEffect(() => {
    if (loaded && !dirtyRef.current) present(loaded);
  }, [currency?.id, currency?.minorUnit]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!expanded || !active || loaded) return;
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setError("");
    void api<MarketPriceSettings>(base, { signal: abort.signal })
      .then((value) => {
        if (alive.current && !abort.signal.aborted) present(value);
      })
      .catch((cause) => {
        if (alive.current && !abort.signal.aborted && !isAbortError(cause))
          setError(message(cause));
      })
      .finally(() => {
        if (alive.current && !abort.signal.aborted) setLoading(false);
      });
    return () => {
      abort.abort();
      if (alive.current) setLoading(false);
    };
  }, [expanded, active, accountId, retry]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saveLock.current || !loaded || disabled) return;
    setError("");
    setNotice("");
    if (draftMismatch) {
      setError(a.draftCurrencyMismatch);
      return;
    }
    const digits = (draftCurrency.current ?? currency)?.minorUnit ?? 2;
    const adjust = parseMajorToMinor(adjustment, digits, {
      allowNegative: true,
    });
    const min =
      minimum.trim() === "" ? null : parseMajorToMinor(minimum, digits);
    const max =
      maximum.trim() === "" ? null : parseMajorToMinor(maximum, digits);
    if (
      adjust === null ||
      (minimum.trim() && min === null) ||
      (maximum.trim() && max === null)
    ) {
      setError(interpolate(a.invalidAmount, { digits }));
      return;
    }
    if (
      [adjust, min, max].some(
        (value) => value !== null && Math.abs(value) > 1_000_000_000,
      )
    ) {
      setError(a.amountRange);
      return;
    }
    if (min !== null && max !== null && min > max) {
      setError(a.invalidLimits);
      return;
    }
    const pause = Number(delay);
    if (
      !/^\d+$/.test(delay) ||
      !Number.isSafeInteger(pause) ||
      pause < 1 ||
      pause > 60
    ) {
      setError(a.invalidDelay);
      return;
    }
    const monetary = adjust !== 0 || min !== null || max !== null;
    if (monetary && !currency) {
      setError(a.currencyRequired);
      return;
    }
    saveLock.current = true;
    setSaving(true);
    onEditingChange(true);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const value = await api<MarketPriceSettings>(base, {
        method: "PUT",
        signal: abort.signal,
        body: JSON.stringify({
          priceMode: mode,
          adjustment: adjust,
          minBuyerPrice: min,
          maxBuyerPrice: max,
          delaySeconds: pause,
          currencyId: monetary ? currency!.id : null,
        }),
      });
      if (alive.current) {
        dirtyRef.current = false;
        setDirty(false);
        storePriceRulesDraft(accountId, null);
        present(value);
        setNotice(a.rulesSaved);
      }
    } catch (cause) {
      if (alive.current && !isAbortError(cause)) setError(message(cause));
    } finally {
      saveLock.current = false;
      if (alive.current) {
        setSaving(false);
        onEditingChange(dirtyRef.current);
      }
    }
  }

  return (
    <section
      className={
        embedded
          ? "grid min-w-0 gap-4"
          : "grid min-w-0 gap-3 rounded-lg border border-[var(--line)] p-3"
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {embedded ? (
          <h3
            tabIndex={-1}
            className="flex items-center gap-2 text-sm font-semibold outline-none"
          >
            <Settings2 size={15} />
            {a.priceRules}
          </h3>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="justify-start"
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={() => setOpen(!open)}
            disabled={saving}
          >
            <Settings2 size={15} />
            {a.priceRules}
          </Button>
        )}
        {dirty && (
          <>
            <Badge tone="warn">{a.unsavedRules}</Badge>
            <Button
              size="sm"
              variant="ghost"
              disabled={saving}
              onClick={discard}
            >
              {a.discardRules}
            </Button>
          </>
        )}
      </div>
      {expanded && (
        <div id={contentId} className="grid min-w-0 gap-3">
          <p className="text-xs leading-5 text-[var(--muted)]">
            {a.priceDescription}
          </p>
          {loading && (
            <p role="status" className="text-xs">
              {a.rulesLoading}
            </p>
          )}
          {error && <Alert tone="danger">{error}</Alert>}
          {error && !loaded && !loading && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRetry((value) => value + 1)}
            >
              {a.retryRules}
            </Button>
          )}
          {notice && <Alert tone="success">{notice}</Alert>}
          {(loaded || dirty) && (
            <form
              onSubmit={(event) => void save(event)}
              className="grid min-w-0 gap-3"
            >
              {currency ? (
                <p className="text-xs leading-5 text-[var(--muted)]">
                  {interpolate(a.currencyBinding, {
                    currency: (draftCurrency.current ?? currency).code,
                  })}
                </p>
              ) : (
                <Alert>{a.currencyRequired}</Alert>
              )}
              {draftMismatch ? (
                <Alert tone="warning">{a.draftCurrencyMismatch}</Alert>
              ) : (
                mismatch && (
                  <Alert tone="warning">
                    {locale === "de"
                      ? "Die gespeicherten Preisbeträge gehören zu einer anderen Wallet-Währung. Die Beträge wurden im Formular geleert; prüfe sie vor dem Speichern neu."
                      : "Saved price amounts use a different wallet currency. Amounts were reset in this form; review them before saving."}
                  </Alert>
                )
              )}
              <Label>
                {a.priceMode}
                <Select
                  value={mode}
                  onChange={(event) => {
                    const value = event.target
                      .value as MarketPriceSettings["priceMode"];
                    setMode(value);
                    change({ priceMode: value });
                  }}
                  disabled={disabled || saving}
                >
                  <option value="lowestSellOrder">{a.lowestSellOrder}</option>
                  <option value="highestBuyOrder">{a.highestBuyOrder}</option>
                </Select>
              </Label>
              <p className="text-xs text-[var(--muted)]">
                {mode === "highestBuyOrder" ? a.highestHelp : a.lowestHelp}
              </p>
              <div className="grid min-w-0 gap-3 sm:grid-cols-3">
                <Label>
                  {a.adjustment}
                  {currency
                    ? ` (${(draftCurrency.current ?? currency).code})`
                    : ""}
                  <Input
                    inputMode="text"
                    type="text"
                    value={adjustment}
                    onChange={(event) => {
                      setAdjustment(event.target.value);
                      change({ adjustment: event.target.value });
                    }}
                    disabled={disabled || saving || !currency}
                  />
                </Label>
                <Label>
                  {a.minPrice}
                  <Input
                    inputMode="decimal"
                    type="text"
                    placeholder={a.optional}
                    value={minimum}
                    onChange={(event) => {
                      setMinimum(event.target.value);
                      change({ minimum: event.target.value });
                    }}
                    disabled={disabled || saving || !currency}
                  />
                </Label>
                <Label>
                  {a.maxPrice}
                  <Input
                    inputMode="decimal"
                    type="text"
                    placeholder={a.optional}
                    value={maximum}
                    onChange={(event) => {
                      setMaximum(event.target.value);
                      change({ maximum: event.target.value });
                    }}
                    disabled={disabled || saving || !currency}
                  />
                </Label>
              </div>
              <p className="text-xs leading-5 text-[var(--muted)]">
                {a.adjustmentHelp}
              </p>
              <Label>
                {a.delay}
                <Input
                  type="number"
                  min={1}
                  max={60}
                  step={1}
                  value={delay}
                  onChange={(event) => {
                    setDelay(event.target.value);
                    change({ delay: event.target.value });
                  }}
                  disabled={disabled || saving}
                  className="max-w-32"
                />
              </Label>
              <Button
                type="submit"
                size="sm"
                className="justify-self-start"
                disabled={
                  disabled ||
                  saving ||
                  loading ||
                  !loaded ||
                  draftMismatch ||
                  (!currency && loaded?.currencyId !== null)
                }
              >
                {saving ? a.savingRules : a.saveRules}
              </Button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
