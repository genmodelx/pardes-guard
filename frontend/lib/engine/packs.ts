// Country packs: visa routes, requirements, labour rules, checklists and document guides, exported
// from backend/app/packs/data by scripts/export_data.py. Approved content updates (made by an admin
// through the research flow) are layered on top at runtime.
//
// This module holds no data itself. The caller passes packs in: tests and build-time code use
// lib/engine/bundled.ts (all countries), the browser loads only the countries it needs (lib/packs.ts).

import type { ChecklistItem, CountryPack, CountrySummary, DocumentGuide, Requirement, RouteSummary, Translatable, VisaRoute } from "@/lib/types";

export type PackWithDomains = CountryPack & { official_domains?: string[] };

/** Approved requirement updates, keyed by country then route. */
export type PackOverrides = Record<string, Record<string, Requirement[]>>;

export class PackRegistry {
  private packs = new Map<string, PackWithDomains>();

  constructor(packs: PackWithDomains[], overrides: PackOverrides = {}) {
    for (const p of packs) this.packs.set(p.code.toUpperCase(), structuredClone(p));
    for (const [country, routes] of Object.entries(overrides)) {
      for (const [routeId, reqs] of Object.entries(routes)) {
        for (const r of reqs) this.applyRequirement(country, routeId, r);
      }
    }
  }

  get(code: string | null | undefined): PackWithDomains | null {
    return code ? this.packs.get(code.toUpperCase()) ?? null : null;
  }

  all(): PackWithDomains[] {
    return [...this.packs.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  destinations(): PackWithDomains[] {
    return this.all().filter((p) => p.kind !== "origin");
  }

  origins(): PackWithDomains[] {
    return this.all().filter((p) => p.kind !== "destination");
  }

  route(code: string, routeId: string): VisaRoute | null {
    return this.get(code)?.visa_routes.find((r) => r.id === routeId) ?? null;
  }

  /** Add or replace one requirement after an admin approved it; marks it verified. */
  applyRequirement(code: string, routeId: string, req: Requirement): void {
    const route = this.route(code, routeId);
    if (!route) return;
    const i = route.requirements.findIndex((r) => r.id === req.id);
    const verified: Requirement = { ...req, status: "verified" };
    if (i >= 0) route.requirements[i] = verified;
    else route.requirements.push(verified);
  }
}

export function summarize(p: CountryPack): CountrySummary {
  const routes: RouteSummary[] = p.visa_routes.map((r) => {
    const tests = new Set<string>();
    for (const q of r.requirements) {
      if (q.rule?.type === "language_any_of") q.rule.options.forEach((o) => tests.add(o.test));
    }
    return {
      id: r.id,
      name: r.name,
      purpose: r.purpose,
      status: r.status,
      requirement_count: r.requirements.length,
      language_tests: [...tests].sort(),
    };
  });
  return { code: p.code, name: p.name, kind: p.kind, status: p.status, currency: p.currency ?? null, routes };
}

/** What workers see: the research allowlist stays internal. */
export function publicPack(p: PackWithDomains): CountryPack {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { official_domains, ...rest } = p;
  return rest;
}

// ---- Translations ---------------------------------------------------------------------------------

/**
 * A copy of one item with its translated fields put in place for `locale`. A field that has no
 * translation, an empty one, or a list of the wrong length keeps its English text, so a half-finished
 * translation can never drop or misalign content.
 */
export function localized<T extends Translatable>(item: T, locale: string): T {
  const fields = item.i18n?.[locale];
  if (!fields) return item;
  const out = { ...item } as Record<string, unknown>;
  for (const [name, text] of Object.entries(fields)) {
    const source = (item as Record<string, unknown>)[name];
    if (Array.isArray(source)) {
      if (Array.isArray(text) && text.length === source.length && text.every((t) => typeof t === "string" && t.trim())) out[name] = text;
    } else if (typeof source === "string" && typeof text === "string" && text.trim()) {
      out[name] = text;
    }
  }
  return out as T;
}

const each = <T extends Translatable>(items: T[] | undefined, locale: string): T[] => (items ?? []).map((i) => localized(i, locale));

/** A whole pack in `locale`, for display. Rules and matching keep using the English pack. */
export function localizedPack<P extends CountryPack>(pack: P, locale: string): P {
  if (locale === "en") return pack;
  const top = localized(pack, locale);
  return {
    ...top,
    departure_checklist: each<ChecklistItem>(pack.departure_checklist, locale),
    arrival_checklist: each<ChecklistItem>(pack.arrival_checklist, locale),
    documents: each<DocumentGuide>(pack.documents, locale),
    complaint_channels: each(pack.complaint_channels, locale),
    embassy_contacts: each(pack.embassy_contacts, locale),
    labour_rules: localized(pack.labour_rules, locale),
    visa_routes: pack.visa_routes.map((route) => ({
      ...localized(route, locale),
      steps: each(route.steps, locale),
      requirements: each(route.requirements, locale),
      fees: each(route.fees, locale),
    })),
  };
}

/** True when `item` has its own text for `field` in `locale` (so the screen is not falling back to English). */
export function isTranslated(item: Translatable, locale: string, field: string): boolean {
  if (locale === "en") return true;
  const text = item.i18n?.[locale]?.[field];
  return Array.isArray(text) ? text.length > 0 : typeof text === "string" && text.trim() !== "";
}

// ---- Document guides ------------------------------------------------------------------------------

export interface ResolvedDocument {
  /** The country whose pack holds the guide. */
  country: string;
  guide: DocumentGuide;
}

/**
 * Find a document guide by id for a journey: the person's own country first (a passport means their
 * passport), then the country they are going to (a CAS comes from there).
 */
export function resolveDocument(id: string, origin: CountryPack | null, destination: CountryPack | null): ResolvedDocument | null {
  for (const pack of [origin, destination]) {
    const guide = pack?.documents?.find((d) => d.id === id);
    if (pack && guide) return { country: pack.code, guide };
  }
  return null;
}
