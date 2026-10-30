import { useEffect, useRef, useState } from "react";
import { Package } from "lucide-react";
import type { MarketCurrency } from "@steam-bee/contracts";

export function SelectionCheckbox({
  checked,
  mixed = false,
  onChange,
  label,
  disabled = false,
  descriptionId,
}: {
  checked: boolean;
  mixed?: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
  descriptionId?: string | undefined;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed && !checked;
  }, [checked, mixed]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      aria-describedby={descriptionId}
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      className="h-4 w-4 shrink-0 accent-[var(--primary)]"
    />
  );
}

export function InventoryArtwork({
  src,
  game = false,
  className,
}: {
  src: string | null | undefined;
  game?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={
        className ??
        `grid shrink-0 place-items-center overflow-hidden rounded-md bg-[var(--surface-3)] ${game ? "h-8 w-16" : "h-16 w-14"}`
      }
    >
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="h-full w-full object-contain"
        />
      ) : (
        <Package
          aria-hidden="true"
          size={game ? 20 : 24}
          className="text-[var(--muted)]"
        />
      )}
    </span>
  );
}

/** Wallet minor units to a localized amount; unknown amounts stay a dash. */
export function formatMoney(
  amount: number | null,
  currency: MarketCurrency | null,
  locale: string,
) {
  if (amount === null || !currency || !Number.isSafeInteger(amount)) return "—";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.code,
    minimumFractionDigits: currency.minorUnit,
    maximumFractionDigits: currency.minorUnit,
  }).format(amount / 10 ** currency.minorUnit);
}
