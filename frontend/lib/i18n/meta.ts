// Server side only: the browser-tab title of a page, in the page's language.

import type { Metadata } from "next";
import { isUiLocale } from "./config";
import { dictionaryFor } from "./dictionaries";
import type { Key } from "./locales/en";

type Params = Promise<{ locale: string }>;

/** `export const generateMetadata = titled("journey.title")` gives a page its translated title. */
export function titled(key: Key, extra: Metadata = {}) {
  return async ({ params }: { params: Params }): Promise<Metadata> => {
    const { locale } = await params;
    return isUiLocale(locale) ? { title: dictionaryFor(locale)[key], ...extra } : extra;
  };
}
