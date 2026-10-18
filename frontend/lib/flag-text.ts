"use client";

// The words of a check result in the reader's language. The rule engine keeps an English title and
// explanation on every flag, plus the values it used (params) and which wording applies (variant).
// This turns them into the dictionary's sentences. Where the dictionary has no sentence for a flag,
// the English one is shown and marked as English.

import { useMemo } from "react";
import { localized } from "@/lib/engine/packs";
import { useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/i18n";
import type { CountryPack, Evidence, ExtractedDocument, Flag } from "@/lib/types";

export interface Words {
  text: string;
  /** "en" when the text had to stay English. */
  lang?: string;
}

export interface FlagWords {
  title: (flag: Flag) => Words;
  explanation: (flag: Flag) => Words;
  /** Who to confirm with, or null. */
  verify: (flag: Flag) => Words | null;
  evidenceLabel: (e: Evidence, documents: ExtractedDocument[]) => string;
  evidenceValue: (e: Evidence) => Words;
  nextSteps: (codes: string[] | undefined, english: string[]) => Words[];
  regulator: Words | null;
}

const LIST_SEPARATOR: Record<string, string> = { ur: "، ", pa: "، ", ps: "، ", sd: "، ", ar: "، " };

export function useFlagWords(origin: CountryPack | null): FlagWords {
  const { t, locale, date, has } = useI18n();
  return useMemo<FlagWords>(() => {
    const sep = LIST_SEPARATOR[locale] ?? ", ";
    const regulator: Words | null = origin?.regulator
      ? { text: localized(origin, locale).regulator ?? origin.regulator, lang: locale !== "en" && !origin.i18n?.[locale]?.regulator ? "en" : undefined }
      : null;

    const params = (flag: Flag): Record<string, string | number> => {
      const out: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(flag.params ?? {})) {
        // A list of fields becomes their names; a calendar date is written the reader's way.
        out[k] = Array.isArray(v) ? v.map((field) => (has(`essential.${field}`) ? t(`essential.${field}` as Key) : field)).join(sep) : typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? date(v) : v;
      }
      return out;
    };

    return {
      regulator,
      title(flag) {
        const key = `flag.${flag.code}`;
        return has(key) ? { text: t(key as Key) } : { text: flag.title, lang: "en" };
      },
      explanation(flag) {
        // The wording for this case first (a borrowed licence), then the flag's usual wording. A
        // sentence still missing a value (a check stored before flags carried their values) is not
        // shown half-filled: the English sentence is shown instead.
        const p = params(flag);
        for (const key of [flag.variant ? `flagx.${flag.code}.${flag.variant}` : null, `flagx.${flag.code}`]) {
          if (!key || !has(key)) continue;
          const text = t(key as Key, p);
          if (!/\{\w+\}/.test(text)) return { text };
        }
        return { text: flag.explanation, lang: "en" };
      },
      verify(flag) {
        if (flag.verify === "regulator") return regulator ?? (flag.verify_with ? { text: flag.verify_with, lang: "en" } : null);
        if (flag.verify && has(`verify.${flag.verify}`)) return { text: t(`verify.${flag.verify}` as Key) };
        return flag.verify_with ? { text: flag.verify_with, lang: "en" } : null;
      },
      evidenceLabel(e, documents) {
        const field = has(`field.${e.field}`) ? t(`field.${e.field}` as Key) : e.field;
        if (e.doc_id === "statement") return `${t("result.said")}, ${field}`;
        // With one paper there is no need to say which; with several, say "Paper 2, Visa type".
        if (documents.length < 2) return field;
        const index = documents.findIndex((d) => d.doc_id === e.doc_id);
        return index >= 0 ? `${t("result.paper", { n: index + 1, type: t(`doc.type.${documents[index].doc_type}` as Key) })}, ${field}` : field;
      },
      evidenceValue(e) {
        const v = e.value.trim().toLowerCase();
        if (v === "true" || v === "yes") return { text: t("common.yes") };
        if (v === "false" || v === "no") return { text: t("common.no") };
        if (v === "not stated") return { text: t("result.notStated") };
        return { text: e.value, lang: "en" };
      },
      nextSteps(codes, english) {
        if (!codes?.length) return english.map((text) => ({ text, lang: "en" }));
        return codes.map((code, i) => {
          const key = `next.${code}`;
          if (!has(key)) return { text: english[i] ?? code, lang: "en" };
          return { text: t(key as Key, { office: regulator?.text ?? t("verify.labour_ministry") }) };
        });
      },
    };
  }, [t, locale, date, origin]);
}
