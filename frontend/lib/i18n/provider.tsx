"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { isMachine, languageInfo, type LanguageInfo, type UiLocale } from "./config";
import { formatDate, formatMoney, formatNumber } from "./format";
import type { Dict, Key } from "./locales/en";
import { hasKey, makeT, type Translate } from "./t";
import type { Money } from "@/lib/types";

export interface I18n {
  locale: UiLocale;
  info: LanguageInfo;
  dir: "ltr" | "rtl";
  /** True when this interface language was drafted by machine. */
  machine: boolean;
  t: Translate;
  /** True when the dictionary has `key`, for keys built from codes (flag.X, edu.Y). */
  has: (key: string) => key is Key;
  date: (iso: string | null | undefined, withTime?: boolean) => string;
  money: (m: Pick<Money, "amount" | "currency"> | null | undefined) => string;
  number: (n: number) => string;
  /** Prefix an app path with the current locale: href("/journey") gives "/ur/journey/". */
  href: (path: string) => string;
}

const I18nContext = createContext<I18n | null>(null);

/** "/journey?x=1" becomes "/ur/journey/?x=1". The trailing slash matches the static export. */
export function localePath(locale: string, path: string): string {
  const [rawPath, query = ""] = path.split("?");
  const [pathname, hash = ""] = rawPath.split("#");
  const clean = pathname.replace(/^\/+|\/+$/g, "");
  const base = clean ? `/${locale}/${clean}/` : `/${locale}/`;
  return base + (query ? `?${query}` : "") + (hash ? `#${hash}` : "");
}

export function I18nProvider({ locale, dict, children }: { locale: UiLocale; dict: Dict; children: ReactNode }) {
  const value = useMemo<I18n>(() => {
    const info = languageInfo(locale);
    return {
      locale,
      info,
      dir: info.dir,
      machine: isMachine(locale),
      t: makeT(dict),
      has: (key: string): key is Key => hasKey(dict, key),
      date: (iso, withTime) => formatDate(locale, iso, withTime),
      money: formatMoney,
      number: formatNumber,
      href: (path) => localePath(locale, path),
    };
  }, [locale, dict]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
