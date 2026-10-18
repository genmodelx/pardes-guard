// Dates and amounts. Numbers are never translated: every locale shows Western digits (0-9), and an
// amount always carries its currency code. Phone numbers and URLs are never passed through here.

import type { Money } from "@/lib/types";
import { languageInfo } from "./config";

const dateCache = new Map<string, Intl.DateTimeFormat>();

function dateFormat(locale: string, withTime: boolean): Intl.DateTimeFormat {
  const key = `${locale}|${withTime}`;
  let f = dateCache.get(key);
  if (!f) {
    const options: Intl.DateTimeFormatOptions = withTime
      ? // 24-hour time: "AM" and "PM" are Latin letters that jump around inside Urdu text.
        { dateStyle: "medium", timeStyle: "short", hourCycle: "h23", timeZone: undefined }
      : { dateStyle: "medium", timeZone: "UTC" };
    try {
      f = new Intl.DateTimeFormat(languageInfo(locale).intl, options);
    } catch {
      f = new Intl.DateTimeFormat("en-GB-u-ca-gregory-nu-latn", options);
    }
    dateCache.set(key, f);
  }
  return f;
}

/** "13 Oct 2026". A plain date (YYYY-MM-DD) is shown as that calendar day in every time zone. */
export function formatDate(locale: string, iso: string | null | undefined, withTime = false): string {
  if (!iso) return "";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(dateOnly ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return dateFormat(locale, withTime && !dateOnly).format(d);
}

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** 450000 becomes "450,000" in every locale. */
export function formatNumber(n: number): string {
  return numberFormat.format(n);
}

/** "450,000 PKR". The currency code is kept as a code so it matches what is printed on receipts. */
export function formatMoney(m: Pick<Money, "amount" | "currency"> | null | undefined): string {
  if (!m) return "";
  return `${formatNumber(m.amount)} ${m.currency}`;
}

/** Stamp dates are short and capital: "13 OCT 2026". Always Latin, like a real date stamp. */
export function formatStampDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return "";
  const month = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][d.getUTCMonth()];
  return `${d.getUTCDate()} ${month} ${d.getUTCFullYear()}`;
}

const listCache = new Map<string, Intl.ListFormat>();

/** "Passport, ID card and degree", joined the way the reader's language joins a list. */
export function formatList(locale: string, items: string[]): string {
  let f = listCache.get(locale);
  if (!f) {
    try {
      f = new Intl.ListFormat(languageInfo(locale).intl, { type: "conjunction" });
    } catch {
      f = new Intl.ListFormat("en", { type: "conjunction" });
    }
    listCache.set(locale, f);
  }
  return f.format(items);
}
