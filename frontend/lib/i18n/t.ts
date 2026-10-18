// The lookup the browser runs. It never imports a dictionary itself: the page's own dictionary,
// already complete (English fills any gap on the server, see translate.ts), arrives as data. That
// keeps the English dictionary out of every page's JavaScript.

import type { Dict, Key } from "./locales/en";

export type Vars = Record<string, string | number>;

/** Replace {name} placeholders. A missing value keeps its placeholder, which makes the gap visible in testing. */
export function fill(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

export type Translate = (key: Key, vars?: Vars) => string;

export function makeT(dict: Dict): Translate {
  return (key, vars) => fill(dict[key] ?? key, vars);
}

/** True when `dict` has a string for `value`, for keys built from codes (flag.X, edu.Y). */
export function hasKey(dict: Dict, value: string): value is Key {
  return Object.prototype.hasOwnProperty.call(dict, value);
}
