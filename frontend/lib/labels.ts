"use client";

// Names that screens need again and again: a country, a journey step, a stage.

import { useMemo } from "react";
import type { PlanItem, StageId } from "@/lib/engine/journey";
import { localized } from "@/lib/engine/packs";
import { useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/i18n";
import { indexEntry } from "@/lib/packs";

export interface Labels {
  /** A country's name in the reader's language. null for no country. */
  country: (code: string | null | undefined) => string | null;
  /** A step's title. Steps done inside the app take their words from the interface dictionary. */
  itemTitle: (item: PlanItem) => string;
  itemDescription: (item: PlanItem) => string;
  /** The language the step's text is written in: English when the pack has no translation yet. */
  itemLang: (item: PlanItem) => string | undefined;
  stage: (id: StageId) => string;
  /** A sorter for names in the reader's language. */
  compare: (a: string, b: string) => number;
}

export function useLabels(): Labels {
  const { t, locale, has } = useI18n();
  return useMemo<Labels>(() => {
    let collator: Intl.Collator | null = null;
    try {
      collator = new Intl.Collator(locale);
    } catch {
      collator = null;
    }
    return {
      country(code) {
        if (!code) return null;
        const key = `country.${code.toUpperCase()}`;
        if (has(key)) return t(key);
        const entry = indexEntry(code);
        return entry ? localized(entry, locale).name : code.toUpperCase();
      },
      itemTitle: (item) => (item.app ? t(`app.${item.app}` as Key) : item.title),
      itemDescription: (item) => (item.app ? t(`app.${item.app}.d` as Key) : item.description),
      itemLang: (item) => (item.translated ? undefined : "en"),
      stage: (id) => t(`journey.stage.${id}` as Key),
      compare: (a, b) => (collator ? collator.compare(a, b) : a.localeCompare(b)),
    };
  }, [t, locale]);
}

/** The app path of a journey step's own screen. */
export function itemHref(id: string): string {
  return `/journey/item?id=${encodeURIComponent(id)}`;
}

/** The app path of a document guide. */
export function documentHref(country: string, id: string): string {
  return `/documents/${country.toLowerCase()}/${id}`;
}
