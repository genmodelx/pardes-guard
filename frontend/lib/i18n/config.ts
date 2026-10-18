// Languages. Two lists that are easy to mix up:
//  - UI_LOCALES: languages the interface itself is written in. Each one is a URL prefix (/ur/...).
//  - AI_LANGUAGES: languages Gemini can answer in (explanations, letters, assistant, interview).
//    A Pashto speaker uses the English interface and gets answers in Pashto.

export type Dir = "ltr" | "rtl";
export type Script = "latin" | "nastaliq" | "naskh" | "devanagari" | "bengali" | "sinhala" | "tamil";

export interface LanguageInfo {
  /** BCP 47 code. Also the value of the HTML lang attribute. */
  code: string;
  /** The language's name written in its own script. */
  native: string;
  /** English name, shown small beside the native one. */
  english: string;
  dir: Dir;
  script: Script;
  /** Locale for dates. Western digits and the Gregorian calendar are forced: a visa date must read the same in every language. */
  intl: string;
  /** Locale for speech recognition and synthesis. */
  speech: string;
  /** How prompts name this language to Gemini (backend/app/llm/prompts.py LANGUAGE_NAMES). */
  promptName: string;
  /** "Machine translation", in the language itself, for interface languages drafted by machine. */
  machineLabel?: string;
}

export const LANGUAGES = {
  en: { code: "en", native: "English", english: "English", dir: "ltr", script: "latin", intl: "en-GB-u-ca-gregory-nu-latn", speech: "en-GB", promptName: "simple English" },
  ur: { code: "ur", native: "اردو", english: "Urdu", dir: "rtl", script: "nastaliq", intl: "ur-PK-u-ca-gregory-nu-latn", speech: "ur-PK", promptName: "Urdu (Urdu script)" },
  hi: { code: "hi", native: "हिन्दी", english: "Hindi", dir: "ltr", script: "devanagari", intl: "hi-IN-u-ca-gregory-nu-latn", speech: "hi-IN", promptName: "Hindi", machineLabel: "मशीन अनुवाद" },
  bn: { code: "bn", native: "বাংলা", english: "Bengali", dir: "ltr", script: "bengali", intl: "bn-BD-u-ca-gregory-nu-latn", speech: "bn-BD", promptName: "Bengali", machineLabel: "মেশিনে করা অনুবাদ" },
  ne: { code: "ne", native: "नेपाली", english: "Nepali", dir: "ltr", script: "devanagari", intl: "ne-NP-u-ca-gregory-nu-latn", speech: "ne-NP", promptName: "Nepali", machineLabel: "मेसिन अनुवाद" },
  fil: { code: "fil", native: "Filipino", english: "Filipino", dir: "ltr", script: "latin", intl: "fil-PH-u-ca-gregory-nu-latn", speech: "fil-PH", promptName: "Filipino (Tagalog)", machineLabel: "Awtomatikong salin" },
  pa: { code: "pa", native: "پنجابی", english: "Punjabi (Shahmukhi)", dir: "rtl", script: "nastaliq", intl: "pa-Arab-PK-u-ca-gregory-nu-latn", speech: "pa-PK", promptName: "Punjabi (Shahmukhi script)" },
  ps: { code: "ps", native: "پښتو", english: "Pashto", dir: "rtl", script: "naskh", intl: "ps-AF-u-ca-gregory-nu-latn", speech: "ps-AF", promptName: "Pashto" },
  sd: { code: "sd", native: "سنڌي", english: "Sindhi", dir: "rtl", script: "naskh", intl: "sd-PK-u-ca-gregory-nu-latn", speech: "sd-PK", promptName: "Sindhi" },
  ar: { code: "ar", native: "العربية", english: "Arabic", dir: "rtl", script: "naskh", intl: "ar-SA-u-ca-gregory-nu-latn", speech: "ar-SA", promptName: "Arabic" },
  si: { code: "si", native: "සිංහල", english: "Sinhala", dir: "ltr", script: "sinhala", intl: "si-LK-u-ca-gregory-nu-latn", speech: "si-LK", promptName: "Sinhala" },
  ta: { code: "ta", native: "தமிழ்", english: "Tamil", dir: "ltr", script: "tamil", intl: "ta-LK-u-ca-gregory-nu-latn", speech: "ta-IN", promptName: "Tamil" },
  id: { code: "id", native: "Bahasa Indonesia", english: "Indonesian", dir: "ltr", script: "latin", intl: "id-ID-u-ca-gregory-nu-latn", speech: "id-ID", promptName: "Bahasa Indonesia" },
} as const satisfies Record<string, LanguageInfo>;

export type LanguageCode = keyof typeof LANGUAGES;

/** Interface languages, in the order the language picker shows them. */
export const UI_LOCALES = ["ur", "en", "hi", "bn", "ne", "fil"] as const;
export type UiLocale = (typeof UI_LOCALES)[number];
export const DEFAULT_LOCALE: UiLocale = "en";

/** Interface languages drafted by machine. The interface shows a "machine translation" label for these. */
export const MACHINE_LOCALES: readonly UiLocale[] = ["hi", "bn", "ne", "fil"];

/** Languages Gemini answers in, in the order Settings shows them. */
export const AI_LANGUAGES: readonly LanguageCode[] = ["ur", "en", "pa", "ps", "sd", "hi", "bn", "ne", "fil", "si", "ta", "id", "ar"];

export function isUiLocale(value: unknown): value is UiLocale {
  return typeof value === "string" && (UI_LOCALES as readonly string[]).includes(value);
}

export function languageInfo(code: string | null | undefined): LanguageInfo {
  const base = (code ?? "").toLowerCase().split("-")[0];
  return (LANGUAGES as Record<string, LanguageInfo>)[base] ?? LANGUAGES.en;
}

export function isMachine(locale: string): boolean {
  return (MACHINE_LOCALES as readonly string[]).includes(locale);
}

/** The web font to preload for a script. Latin is always preloaded as well. */
export const SCRIPT_FONT: Record<Script, string | null> = {
  latin: null,
  nastaliq: "Noto Nastaliq Urdu",
  naskh: "Noto Naskh Arabic",
  devanagari: "Noto Sans Devanagari",
  bengali: "Noto Sans Bengali",
  sinhala: "Noto Sans Sinhala",
  tamil: "Noto Sans Tamil",
};

/** Best interface language for a browser language list, or null when none matches. */
export function matchUiLocale(preferred: readonly string[]): UiLocale | null {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split("-")[0];
    const code = base === "tl" ? "fil" : base;
    if (isUiLocale(code)) return code;
  }
  return null;
}

export const LOCALE_STORAGE_KEY = "pg.locale";
export const THEME_STORAGE_KEY = "pg.theme";
