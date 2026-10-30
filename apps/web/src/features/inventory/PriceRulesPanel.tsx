import type { MarketCurrency, MarketPriceSettings } from "@steam-bee/contracts";
import { useEffect, useId, useRef, useState } from "react";
import { Settings2 } from "lucide-react";
import { api, ApiError, apiErrorMessage, isAbortError } from "../../api";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input, Label } from "../../components/ui/form";
import { interpolate, useI18n } from "../../i18n";
import { advancedInventoryCopy } from "./advanced-copy";
import { formatMinorToMajor, parseMajorToMinor } from "./inventory-model";
import { formatMoney } from "./inventory-ui";
import { exampleSource, priceExample } from "./price-example";
import { cn } from "../../lib/utils";
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
  const { locale, localeInfo, messages } = useI18n();
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
    const amount = (minor: number) => {
      const text = formatMinorToMajor(minor, digits);
      return text === null
        ? null
        : localizeDecimal(text, localeInfo.dateLocale);
    };
    setMode(value.priceMode);
    setAdjustment(sameCurrency ? (amount(value.adjustment) ?? "0") : "0");
    setMinimum(
      sameCurrency && value.minBuyerPrice !== null
        ? (amount(value.minBuyerPrice) ?? "")
        : "",
    );
    setMaximum(
      sameCurrency && value.maxBuyerPrice !== null
        ? (amount(value.maxBuyerPrice) ?? "")
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
          <h3 tabIndex={-1} className="sr-only">
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
                  <Alert tone="warning">{a.savedCurrencyMismatch}</Alert>
                )
              )}
              <StrategyPicker
                mode={mode}
                adjustment={adjustment}
                minimum={minimum}
                maximum={maximum}
                currency={draftCurrency.current ?? currency}
                disabled={disabled || saving}
                onPick={(priceMode, amount) => {
                  const digits =
                    (draftCurrency.current ?? currency)?.minorUnit ?? 2;
                  const text = localizeDecimal(
                    formatMinorToMajor(amount, digits) ?? "0",
                    localeInfo.dateLocale,
                  );
                  setMode(priceMode);
                  setAdjustment(text);
                  change({ priceMode, adjustment: text });
                }}
              />
              <PriceScale
                mode={mode}
                adjustment={adjustment}
                minimum={minimum}
                maximum={maximum}
                currency={draftCurrency.current ?? currency}
              />
              <section className="grid min-w-0 gap-3 rounded-lg border border-[var(--line)] p-3">
                <h4 className="text-sm font-semibold">{a.fineTune}</h4>
                <div className="@container grid min-w-0 gap-3">
                  <fieldset
                    role="radiogroup"
                    className="grid min-w-0 gap-2 @min-[28rem]:grid-cols-2"
                    disabled={disabled || saving}
                  >
                    <legend className="mb-1.5 text-xs font-semibold text-[var(--muted-strong)]">
                      {a.priceMode}
                    </legend>
                    {(
                      [
                        ["lowestSellOrder", a.lowestSellOrder, a.lowestCard],
                        ["highestBuyOrder", a.highestBuyOrder, a.highestCard],
                      ] as const
                    ).map(([value, title, hint]) => (
                      <label
                        key={value}
                        className={cn(
                          "flex min-w-0 cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm",
                          mode === value
                            ? "border-[var(--primary)] bg-[var(--surface-2)] ring-1 ring-[var(--primary)]"
                            : "border-[var(--line)] hover:border-[var(--line-strong)]",
                        )}
                      >
                        <input
                          type="radio"
                          name={`${contentId}-mode`}
                          value={value}
                          checked={mode === value}
                          onChange={() => {
                            setMode(value);
                            change({ priceMode: value });
                          }}
                          className="mt-0.5"
                        />
                        <span className="min-w-0">
                          <strong className="block">{title}</strong>
                          <span className="sr-only">{hint}</span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  <p className="text-xs text-[var(--muted)]">
                    {mode === "highestBuyOrder" ? a.highestHelp : a.lowestHelp}
                  </p>
                  <div className="grid min-w-0 gap-3 @min-[28rem]:grid-cols-3">
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
                  <details className="text-sm">
                    <summary className="cursor-pointer font-semibold">
                      {interpolate(a.advancedDelay, { seconds: delay })}
                    </summary>
                    <Label className="mt-2">
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
                  </details>
                </div>
              </section>
              <Button
                type="submit"
                variant="primary"
                className="justify-self-end"
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

/** Shows a "1.23" amount with the locale's decimal separator; parsing accepts both. */
function localizeDecimal(text: string, intlLocale: string) {
  const separator =
    new Intl.NumberFormat(intlLocale)
      .formatToParts(1.5)
      .find((part) => part.type === "decimal")?.value ?? ".";
  return separator === "," ? text.replace(".", ",") : text;
}

const strategies = [
  { id: "instant", mode: "highestBuyOrder", adjustment: 0, speed: 3 },
  { id: "undercut", mode: "lowestSellOrder", adjustment: -1, speed: 2 },
  { id: "match", mode: "lowestSellOrder", adjustment: 0, speed: 1 },
] as const;

function parsedRules(
  adjustment: string,
  minimum: string,
  maximum: string,
  currency: MarketCurrency | null,
) {
  const digits = currency?.minorUnit ?? 2;
  const adjust = parseMajorToMinor(adjustment, digits, { allowNegative: true });
  const min = minimum.trim() === "" ? null : parseMajorToMinor(minimum, digits);
  const max = maximum.trim() === "" ? null : parseMajorToMinor(maximum, digits);
  const valid =
    currency !== null &&
    adjust !== null &&
    (minimum.trim() === "" || min !== null) &&
    (maximum.trim() === "" || max !== null);
  return valid ? { adjust: adjust!, min, max } : null;
}

/** Three presets for the common choices; anything else shows as a custom rule. */
function StrategyPicker({
  mode,
  adjustment,
  minimum,
  maximum,
  currency,
  disabled,
  onPick,
}: {
  mode: MarketPriceSettings["priceMode"];
  adjustment: string;
  minimum: string;
  maximum: string;
  currency: MarketCurrency | null;
  disabled: boolean;
  onPick: (mode: MarketPriceSettings["priceMode"], adjustment: number) => void;
}) {
  const { locale, localeInfo } = useI18n();
  const a = advancedInventoryCopy(locale);
  const name = useId();
  const rules = parsedRules(adjustment, minimum, maximum, currency);
  const current = strategies.find(
    (strategy) =>
      strategy.mode === mode && rules?.adjust === strategy.adjustment,
  );
  const copy = {
    instant: [a.strategyInstant, a.strategyInstantHint],
    undercut: [a.strategyUndercut, a.strategyUndercutHint],
    match: [a.strategyMatch, a.strategyMatchHint],
  } as const;
  return (
    <fieldset
      role="radiogroup"
      className="grid min-w-0 gap-2 sm:grid-cols-3"
      disabled={disabled}
    >
      <legend className="mb-2 text-sm font-semibold">{a.strategy}</legend>
      {strategies.map((strategy) => {
        const selected = current?.id === strategy.id;
        const example = rules
          ? priceExample({
              mode: strategy.mode,
              adjustment: strategy.adjustment,
              minimum: rules.min,
              maximum: rules.max,
            })
          : null;
        const [title, hint] = copy[strategy.id];
        return (
          <label
            key={strategy.id}
            className={cn(
              "grid min-w-0 cursor-pointer content-start gap-2 rounded-xl border p-3 text-sm",
              selected
                ? "border-[var(--accent)] bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]"
                : "border-[var(--line)] bg-[var(--surface)] hover:border-[var(--line-strong)]",
            )}
          >
            <span className="flex items-start gap-2">
              <input
                type="radio"
                name={name}
                checked={selected}
                disabled={disabled || (!currency && strategy.adjustment !== 0)}
                onChange={() => onPick(strategy.mode, strategy.adjustment)}
                className="mt-0.5"
              />
              <strong>{title}</strong>
            </span>
            <span className="text-xs leading-5 text-[var(--muted)]">
              {hint}
            </span>
            <span className="grid gap-1">
              <span className="text-[11px] font-semibold text-[var(--muted-strong)]">
                {a.speed}
              </span>
              <span
                className="flex gap-1"
                role="img"
                aria-label={interpolate(a.speedLevel, {
                  level: strategy.speed,
                })}
              >
                {[1, 2, 3].map((level) => (
                  <span
                    key={level}
                    className={cn(
                      "h-1.5 flex-1 rounded-full",
                      level <= strategy.speed
                        ? "bg-[var(--good)]"
                        : "bg-[var(--line)]",
                    )}
                  />
                ))}
              </span>
            </span>
            {example && (
              <span className="grid">
                <span className="text-[11px] font-semibold text-[var(--muted-strong)]">
                  {a.receiveAbout}
                </span>
                <span className="text-xl font-bold tabular-nums">
                  {formatMoney(
                    example.receive,
                    currency,
                    localeInfo.dateLocale,
                  )}
                </span>
              </span>
            )}
          </label>
        );
      })}
      {!current && (
        <p className="text-xs text-[var(--muted)] sm:col-span-3">
          <strong className="text-[var(--ink)]">{a.strategyCustom}:</strong>{" "}
          {a.strategyCustomHint}
        </p>
      )}
    </fieldset>
  );
}

/** Places the example buyer price between the example market prices. */
function PriceScale({
  mode,
  adjustment,
  minimum,
  maximum,
  currency,
}: {
  mode: MarketPriceSettings["priceMode"];
  adjustment: string;
  minimum: string;
  maximum: string;
  currency: MarketCurrency | null;
}) {
  const { locale, localeInfo } = useI18n();
  const a = advancedInventoryCopy(locale);
  const rules = parsedRules(adjustment, minimum, maximum, currency);
  const money = (value: number) =>
    formatMoney(value, currency, localeInfo.dateLocale);
  if (!rules)
    return (
      <p className="rounded-lg border border-[var(--line)] p-3 text-xs text-[var(--muted)]">
        {a.exampleInvalid}
      </p>
    );
  const example = priceExample({
    mode,
    adjustment: rules.adjust,
    minimum: rules.min,
    maximum: rules.max,
  });
  const buy = exampleSource.highestBuyOrder;
  const sell = exampleSource.lowestSellOrder;
  const points = [buy, sell, example.buyerPays, rules.min, rules.max].filter(
    (value): value is number => value !== null && value <= sell * 3,
  );
  const low = Math.max(0, Math.min(...points) - 3);
  const high = Math.max(...points) + 3;
  const at = (value: number) =>
    `${Math.min(100, Math.max(0, ((value - low) / (high - low)) * 100))}%`;
  return (
    <section
      aria-label={a.scaleTitle}
      className="grid min-w-0 gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-4"
    >
      <div>
        <h4 className="text-sm font-semibold">{a.scaleTitle}</h4>
        <p className="text-xs text-[var(--muted)]">
          {interpolate(a.scaleSubtitle, { buy: money(buy), sell: money(sell) })}
        </p>
      </div>
      <div className="relative mx-2 mb-10 mt-9 h-2" aria-hidden="true">
        <div className="absolute inset-0 rounded-full bg-[var(--line)]" />
        <div
          className="absolute inset-y-0 rounded-full bg-[var(--good-soft)] ring-1 ring-[var(--good-line)]"
          style={{
            left: at(rules.min ?? low),
            right: `calc(100% - ${at(rules.max ?? high)})`,
          }}
        />
        {[
          [buy, a.scaleBuy],
          [sell, a.scaleSell],
        ].map(([value, label]) => (
          <span
            key={label}
            className="absolute top-3 -translate-x-1/2 whitespace-nowrap text-center text-[11px] text-[var(--muted)]"
            style={{ left: at(value as number) }}
          >
            <span className="mx-auto mb-0.5 block h-2 w-px bg-[var(--muted)]" />
            {label}
            <br />
            <strong className="text-[var(--ink)]">
              {money(value as number)}
            </strong>
          </span>
        ))}
        <span
          className="absolute -top-8 -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--primary)] px-2 py-0.5 text-xs font-semibold text-[var(--primary-fg)]"
          style={{ left: at(example.buyerPays) }}
        >
          {interpolate(a.scaleYours, { price: money(example.buyerPays) })}
        </span>
        <span
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-[var(--primary)] bg-[var(--surface)]"
          style={{ left: at(example.buyerPays) }}
        />
      </div>
      <p className="text-sm">
        {interpolate(a.scaleFlow, {
          buyer: money(example.buyerPays),
          fees: money(example.fees),
          receive: money(example.receive),
        })}
        {example.blocked && (
          <span className="block text-xs text-[var(--danger)]">
            {a.exampleBlocked}
          </span>
        )}
      </p>
    </section>
  );
}
