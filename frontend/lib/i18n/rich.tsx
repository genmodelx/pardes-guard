import { Fragment, type ReactNode } from "react";

/**
 * A translated sentence with some of its {placeholders} filled by elements instead of text: a
 * name in <bdi> so it keeps its own direction inside Urdu, or a link. Call t() without those
 * values, so their placeholders are still in the text.
 */
export function rich(text: string, parts: Record<string, ReactNode>): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/\{(\w+)\}/g)) {
    if (!(m[1] in parts)) continue;
    const at = m.index ?? 0;
    out.push(text.slice(last, at), <Fragment key={`${m[1]}@${at}`}>{parts[m[1]]}</Fragment>);
    last = at + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}
