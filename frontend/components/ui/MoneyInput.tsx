"use client";

import { useId } from "react";
import { cx } from "@/lib/cx";
import { useI18n } from "@/lib/i18n";
import type { Money } from "@/lib/types";
import fieldStyles from "./Field.module.css";
import styles from "./MoneyInput.module.css";

/** Currencies a person is likely to be quoted in. The code is shown as printed on receipts. */
export const CURRENCIES = ["PKR", "SAR", "AED", "QAR", "KWD", "OMR", "BHD", "GBP", "EUR", "USD", "CAD", "AUD", "JPY", "KRW", "PHP", "INR", "BDT", "NPR", "LKR", "IDR"] as const;

export interface MoneyValue {
  /** As typed: digits, with commas allowed. */
  amount: string;
  currency: string;
}

/** The typed value as Money, or null when it is empty or not a number above zero. */
export function moneyFrom(value: MoneyValue, period?: Money["period"]): Money | null {
  const n = Number(value.amount.replace(/[,\s]/g, ""));
  if (!value.amount.trim() || !Number.isFinite(n) || n <= 0 || !value.currency) return null;
  return period ? { amount: n, currency: value.currency, period } : { amount: n, currency: value.currency };
}

/** An amount and its currency, side by side. The amount is typed in Western digits, left to right. */
export function MoneyInput({ label, hint, value, onChange, optional, error }: { label: string; hint?: string; value: MoneyValue; onChange: (value: MoneyValue) => void; optional?: boolean; error?: string | null }) {
  const { t } = useI18n();
  const id = useId();
  return (
    <div className={cx(fieldStyles.field, error && fieldStyles.invalid)}>
      <label className={fieldStyles.label} htmlFor={id}>
        {label}
        {optional ? <span className={fieldStyles.optional}> ({t("common.optional")})</span> : null}
      </label>
      {hint ? (
        <p className={fieldStyles.hint} id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      <div className={styles.row}>
        <input
          id={id}
          className={cx(fieldStyles.input, fieldStyles.ltr, styles.amount)}
          inputMode="decimal"
          dir="ltr"
          autoComplete="off"
          value={value.amount}
          onChange={(e) => onChange({ ...value, amount: e.target.value.replace(/[^\d.,\s]/g, "") })}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined}
        />
        <div className={fieldStyles.selectWrap}>
          <select className={cx(fieldStyles.input, fieldStyles.select, styles.currency)} value={value.currency} onChange={(e) => onChange({ ...value, currency: e.target.value })} aria-label={`${label}: ${t("check.currency")}`} dir="ltr">
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error ? (
        <p className={fieldStyles.error} id={`${id}-error`} role="alert">
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
