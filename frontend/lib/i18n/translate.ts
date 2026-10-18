// The lookup itself, kept free of React so it can be unit-tested and used on the server.

// Server and tests only (it imports the English dictionary). The browser uses t.ts.

import { en, type Dict, type Key } from "./locales/en";
import { fill, makeT, type Translate, type Vars } from "./t";

export { fill, makeT, type Translate, type Vars };

/** A complete dictionary for a locale: its own strings, with English wherever a key is missing. */
export function withFallback(partial: Partial<Dict>): Dict {
  const out = { ...en } as Dict;
  for (const key of Object.keys(partial) as Key[]) {
    const value = partial[key];
    if (typeof value === "string" && value.trim() !== "" && key in en) out[key] = value;
  }
  return out;
}

export function missingKeys(partial: Partial<Dict>): Key[] {
  return (Object.keys(en) as Key[]).filter((k) => !partial[k]);
}

/** Keys a locale defines that English does not. These are typos or leftovers. */
export function unknownKeys(partial: Partial<Dict>): string[] {
  return Object.keys(partial).filter((k) => !(k in en));
}

export function isKey(value: string): value is Key {
  return value in en;
}
