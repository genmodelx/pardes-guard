// Language rules: English is the source, other languages fall back to it key by key, numbers are
// never translated, and every string a screen builds by name really exists.

import { describe, expect, it } from "vitest";
import { ALL_PACKS } from "@/lib/engine/bundled";
import { localized, localizedPack } from "@/lib/engine/packs";
import { AI_LANGUAGES, LANGUAGES, MACHINE_LOCALES, UI_LOCALES, isUiLocale, languageInfo, matchUiLocale } from "@/lib/i18n/config";
import { dictionaryFor, partialFor } from "@/lib/i18n/dictionaries";
import { formatDate, formatMoney, formatNumber, formatStampDate } from "@/lib/i18n/format";
import { en, type Key } from "@/lib/i18n/locales/en";
import { localePath } from "@/lib/i18n/provider";
import { fill, makeT, missingKeys, unknownKeys, withFallback } from "@/lib/i18n/translate";
import prompts from "@/data/prompts.json";
import type { DocumentGuide } from "@/lib/types";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("fallback", () => {
  it("uses English for a key the locale does not have, and for an empty translation", () => {
    const dict = withFallback({ "common.back": "واپس", "common.next": "  " });
    expect(dict["common.back"]).toBe("واپس");
    expect(dict["common.next"]).toBe(en["common.next"]);
    expect(dict["common.close"]).toBe(en["common.close"]);
  });

  it("ignores keys that English does not define", () => {
    const dict = withFallback({ ["no.such.key" as Key]: "x" });
    expect("no.such.key" in dict).toBe(false);
    expect(unknownKeys({ ["no.such.key" as Key]: "x" })).toEqual(["no.such.key"]);
  });

  it("fills placeholders and leaves a missing one visible", () => {
    const t = makeT(withFallback({}));
    expect(t("home.stepOf", { n: 3, total: 14 })).toBe("Step 3 of 14");
    expect(fill("{done} of {total}", { done: 1 })).toBe("1 of {total}");
  });
});

describe("dictionaries", () => {
  for (const locale of UI_LOCALES) {
    const partial = partialFor(locale);
    const machine = (MACHINE_LOCALES as readonly string[]).includes(locale);

    it(`${locale}: has no keys English lacks`, () => {
      expect(unknownKeys(partial)).toEqual([]);
    });

    it(`${locale}: keeps the same placeholders as English`, () => {
      const wrong = (Object.keys(partial) as Key[]).filter((k) => JSON.stringify(placeholders(partial[k]!)) !== JSON.stringify(placeholders(en[k])));
      expect(wrong).toEqual([]);
    });

    it(`${locale}: writes digits as 0-9`, () => {
      const translatedDigits = /[\u0660-\u0669\u06F0-\u06F9\u0966-\u096F\u09E6-\u09EF]/;
      expect((Object.keys(partial) as Key[]).filter((k) => translatedDigits.test(partial[k]!))).toEqual([]);
    });

    it(`${locale}: carries no links (those come from the packs, with a source)`, () => {
      expect((Object.keys(partial) as Key[]).filter((k) => /https?:\/\//.test(partial[k]!))).toEqual([]);
    });

    if (!machine) {
      it(`${locale}: is complete`, () => {
        expect(missingKeys(partial)).toEqual([]);
      });
    } else {
      // Staff screens (admin, NGO) stay in English. Anything else missing would show in English
      // in the middle of a translated screen, so a new string gets a draft in every language.
      it(`${locale}: has a draft of every string outside the staff screens`, () => {
        expect(missingKeys(partial).filter((k) => !k.startsWith("admin.") && !k.startsWith("ngo."))).toEqual([]);
      });
    }

    it(`${locale}: gives a full dictionary to the page`, () => {
      const dict = dictionaryFor(locale);
      expect(Object.keys(dict).length).toBe(Object.keys(en).length);
    });
  }

  it("has every string that screens build by name", () => {
    const need: string[] = [
      ...["you", "employer", "university", "government", "recruiter"].map((w) => `who.${w}`),
      ...["todo", "doing", "done", "skipped"].map((s) => `status.${s}`),
      ...["generic", "save", "load", "offline"].map((e) => `error.${e}`),
      ...["explore", "before", "documents", "visa", "departure", "arrival"].map((s) => `journey.stage.${s}`),
      ...["online", "office", "both"].map((w) => `docs.where.${w}`),
      ...["work", "study", "explore"].map((p) => `purpose.${p}`),
      ...["system", "light", "dark"].map((p) => `theme.${p}`),
      ...["red", "amber", "green", "done"].map((l) => `stamp.${l}`),
      ...["red", "amber", "green"].map((l) => `stamp.${l}.line`),
      ...["cas", "protector", "attestation", "iqama", "promoter", "biometrics", "sponsor"].flatMap((t) => [`term.${t}`, `term.${t}.d`]),
      ...["checkOffer", "checkAdmission", "checkAgent", "cost", "readiness", "eligibility", "interview", "vaultCopies", "helpContacts"].flatMap((a) => [`app.${a}`, `app.${a}.d`]),
      ...ALL_PACKS.map((p) => `country.${p.code}`),
    ];
    expect(need.filter((k) => !(k in en))).toEqual([]);
  });
});

describe("languages", () => {
  it("every interface language is a known language with a direction", () => {
    for (const code of UI_LOCALES) {
      expect(isUiLocale(code)).toBe(true);
      expect(["ltr", "rtl"]).toContain(LANGUAGES[code].dir);
    }
    expect(["ur", "pa", "ps", "ar", "sd"].every((c) => languageInfo(c).dir === "rtl")).toBe(true);
    expect(["en", "hi", "bn", "ne", "fil", "si", "ta", "id"].every((c) => languageInfo(c).dir === "ltr")).toBe(true);
  });

  it("names every answer language to Gemini exactly as the backend prompts do", () => {
    const names = prompts.language_names as Record<string, string>;
    for (const code of AI_LANGUAGES) expect(LANGUAGES[code].promptName, code).toBe(names[code]);
    expect(Object.keys(names).sort()).toEqual([...AI_LANGUAGES].sort());
    expect("tl" in names).toBe(false); // Filipino is "fil" everywhere
  });

  it("matches a browser's language list to an interface language", () => {
    expect(matchUiLocale(["ur-PK", "en"])).toBe("ur");
    expect(matchUiLocale(["de-DE", "en-US"])).toBe("en");
    expect(matchUiLocale(["de-DE"])).toBeNull();
    expect(languageInfo("ur-PK").code).toBe("ur");
    expect(languageInfo("xx").code).toBe("en");
  });

  it("builds paths with the language prefix and a trailing slash", () => {
    expect(localePath("ur", "/journey")).toBe("/ur/journey/");
    expect(localePath("en", "/")).toBe("/en/");
    expect(localePath("ur", "/journey/item?id=step:sa-work:medical")).toBe("/ur/journey/item/?id=step:sa-work:medical");
    expect(localePath("en", "documents/PK/passport/#steps")).toBe("/en/documents/PK/passport/#steps");
  });
});

describe("numbers and dates are never translated", () => {
  it("keeps Western digits in every language", () => {
    for (const code of Object.keys(LANGUAGES)) {
      expect(formatDate(code, "2026-10-13"), code).toMatch(/13/);
      expect(formatDate(code, "2026-10-13"), code).toMatch(/2026/);
      expect(formatDate(code, "2026-10-13"), code).not.toMatch(/[\u0660-\u0669\u06F0-\u06F9\u0966-\u096F\u09E6-\u09EF]/);
    }
  });

  it("formats amounts the same way everywhere, always with the currency", () => {
    expect(formatNumber(450000)).toBe("450,000");
    expect(formatMoney({ amount: 1800, currency: "SAR" })).toBe("1,800 SAR");
    expect(formatMoney(null)).toBe("");
  });

  it("shows a plain date as that calendar day and tolerates bad input", () => {
    expect(formatDate("en", "2026-10-13")).toBe("13 Oct 2026");
    expect(formatDate("en", "not a date")).toBe("not a date");
    expect(formatDate("en", null)).toBe("");
    expect(formatStampDate("2026-10-13")).toBe("13 OCT 2026");
    expect(formatStampDate("2026-10-13T23:30:00Z")).toBe("13 OCT 2026");
    expect(formatStampDate("")).toBe("");
  });
});

describe("pack translations", () => {
  const doc: DocumentGuide = { id: "passport", title: "Passport", steps: ["One", "Two"], bring: [], sources: [], status: "draft" };

  it("overlays translated fields and keeps the rest", () => {
    const out = localized({ ...doc, i18n: { ur: { title: "پاسپورٹ", steps: ["ایک", "دو"] } } }, "ur");
    expect(out.title).toBe("پاسپورٹ");
    expect(out.steps).toEqual(["ایک", "دو"]);
    expect(out.id).toBe("passport");
  });

  it("keeps English when a translation is empty, missing or the wrong length", () => {
    expect(localized({ ...doc, i18n: { ur: { title: " " } } }, "ur").title).toBe("Passport");
    expect(localized({ ...doc, i18n: { ur: { steps: ["ایک"] } } }, "ur").steps).toEqual(["One", "Two"]);
    expect(localized({ ...doc, i18n: { ur: { steps: ["ایک", ""] } } }, "ur").steps).toEqual(["One", "Two"]);
    expect(localized(doc, "ur").title).toBe("Passport");
    expect(localized({ ...doc, i18n: { ur: { title: "پاسپورٹ" } } }, "hi").title).toBe("Passport");
  });

  it("never lets a translation change an id, a link or a status", () => {
    const tampered = localized({ ...doc, official_url: "https://example.org", i18n: { ur: { official_url: ["x"], id: ["y"] } as never } }, "ur");
    expect(tampered.official_url).toBe("https://example.org");
    expect(tampered.id).toBe("passport");
  });

  it("localizes a whole pack without touching the original", () => {
    const sa = ALL_PACKS.find((p) => p.code === "SA")!;
    const before = JSON.stringify(sa);
    const ur = localizedPack(sa, "ur");
    expect(ur.visa_routes[0].steps[0].title).toMatch(/[\u0600-\u06FF]/);
    expect(ur.arrival_checklist?.[0].title).toMatch(/[\u0600-\u06FF]/);
    expect(ur.visa_routes[0].steps[0].official_url ?? null).toBe(sa.visa_routes[0].steps[0].official_url ?? null);
    expect(JSON.stringify(sa)).toBe(before);
    expect(localizedPack(sa, "en")).toBe(sa);
  });
});
