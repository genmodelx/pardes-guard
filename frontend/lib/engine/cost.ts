// What a route should really cost, and what an agent's ask leaves over.
//
// A cost shows a number only when the pack gives it with its source and the date someone last
// checked it. Every other cost is listed by name with "check the official site": a guessed fee in
// this app could cost a worker their savings.

import type { Actor, CountryPack, Money, SourceRef, VisaRoute } from "@/lib/types";
import { isTranslated, localized } from "./packs";

export interface CostLine {
  id: string;
  /** The cost's name, in the reader's language where the pack has it. */
  item: string;
  /** False when `item` is still English because the pack has no translation yet. */
  translated: boolean;
  /** Set only when the pack gives the amount with a source and a date. */
  amount: Money | null;
  source: SourceRef | null;
  last_verified: string | null;
  paid_by: Actor | null;
  note: string | null;
}

/** The official costs of a route for a person from `originCode`, in pack order. */
export function routeCosts(route: VisaRoute, originCode: string | null, locale = "en"): CostLine[] {
  return (route.fees ?? [])
    .filter((f) => !f.origins?.length || (originCode !== null && f.origins.includes(originCode.toUpperCase())))
    .map((f) => {
      const shown = localized(f, locale);
      const sourced = f.amount != null && f.amount > 0 && Boolean(f.currency) && Boolean(f.source) && Boolean(f.last_verified);
      return {
        id: f.id,
        item: shown.item,
        translated: isTranslated(f, locale, "item"),
        amount: sourced ? { amount: f.amount as number, currency: (f.currency as string).toUpperCase() } : null,
        source: sourced ? (f.source as SourceRef) : null,
        last_verified: sourced ? (f.last_verified as string) : null,
        paid_by: f.paid_by ?? null,
        note: shown.note ?? null,
      };
    });
}

/** The legal maximum a recruiter may charge, when the home country's pack gives it with its source. */
export function recruitmentFeeCap(origin: CountryPack | null): { amount: Money; source: SourceRef } | null {
  const cap = origin?.max_recruitment_fee;
  const source = origin?.max_recruitment_fee_source;
  return cap && cap.amount > 0 && source ? { amount: { amount: cap.amount, currency: cap.currency.toUpperCase() }, source } : null;
}

/**
 *   yes      the agent's part is above the legal maximum
 *   maybe    it looks above, but some official costs have no checked amount, so it may be lower
 *   no       it is not above the legal maximum
 *   unknown  there is no legal maximum with a source, or it is in another currency
 */
export type CapVerdict = "yes" | "maybe" | "no" | "unknown";

export interface AskAnalysis {
  asked: Money;
  /** Total of the official costs with a checked amount in the asked currency. null when there are none. */
  officialTotal: Money | null;
  /** Costs left out of the total: no checked amount yet. */
  unchecked: number;
  /** Costs with a checked amount in another currency, also left out of the total. */
  otherCurrency: number;
  /**
   * What the ask leaves after the official costs we know: an upper bound of what goes to the agent,
   * because unchecked costs could make the official total larger. Never below zero.
   */
  agentPart: Money;
  cap: { amount: Money; source: SourceRef } | null;
  aboveCap: CapVerdict;
}

/** Compare what an agent asks with the official costs of the route. Pure arithmetic, no rounding of the inputs. */
export function analyzeAsk(lines: CostLine[], asked: Money, origin: CountryPack | null): AskAnalysis {
  const currency = asked.currency.toUpperCase();
  const same = lines.filter((l) => l.amount && l.amount.currency === currency);
  const otherCurrency = lines.filter((l) => l.amount && l.amount.currency !== currency).length;
  const unchecked = lines.filter((l) => !l.amount).length;
  // Sum in whole cents so 0.1 + 0.2 stays 0.3.
  const cents = same.reduce((n, l) => n + Math.round((l.amount as Money).amount * 100), 0);
  const officialTotal = same.length ? { amount: cents / 100, currency } : null;
  const agentPart = { amount: Math.max(0, Math.round(asked.amount * 100 - cents) / 100), currency };

  const cap = recruitmentFeeCap(origin);
  let aboveCap: CapVerdict = "unknown";
  if (cap && cap.amount.currency === currency) {
    if (agentPart.amount <= cap.amount.amount) aboveCap = "no";
    else aboveCap = unchecked > 0 || otherCurrency > 0 ? "maybe" : "yes";
  }
  return { asked: { amount: asked.amount, currency }, officialTotal, unchecked, otherCurrency, agentPart, cap, aboveCap };
}
