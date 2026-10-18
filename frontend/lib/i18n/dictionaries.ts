// Server side only: picks the dictionary for a locale at build time. The locale layout hands the
// result to the client provider, so each page's HTML is already in the right language.

import type { UiLocale } from "./config";
import type { Dict } from "./locales/en";
import { bn } from "./locales/bn";
import { en } from "./locales/en";
import { fil } from "./locales/fil";
import { hi } from "./locales/hi";
import { ne } from "./locales/ne";
import { ur } from "./locales/ur";
import { withFallback } from "./translate";

const PARTIALS: Record<UiLocale, Partial<Dict>> = { en, ur, hi, bn, ne, fil };

export function partialFor(locale: UiLocale): Partial<Dict> {
  return PARTIALS[locale];
}

export function dictionaryFor(locale: UiLocale): Dict {
  return withFallback(PARTIALS[locale]);
}
