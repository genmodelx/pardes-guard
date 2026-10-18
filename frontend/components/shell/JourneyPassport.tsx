"use client";

import { PassportStatus } from "@/components/ui/PassportStatus";
import { useJourney } from "@/lib/data";
import { localToday, type PassportStatus as Status } from "@/lib/engine/readiness";
import { documentHref } from "@/lib/labels";
import type { CountryPack, SourceRef, VisaRoute } from "@/lib/types";

/** Where a visa's passport rule would be published: its passport requirement's sources, then the route's own. */
export function passportSources(route: VisaRoute | null): SourceRef[] {
  if (!route) return [];
  const all = [...(route.requirements.find((r) => r.kind === "passport")?.sources ?? []), ...route.sources];
  return all.filter((s, i) => all.findIndex((x) => x.url === s.url) === i);
}

/** The home country's guide to getting a passport, when its pack has one. */
export function passportGuide(origin: CountryPack | null): string | null {
  return origin?.documents?.some((d) => d.id === "passport") ? documentHref(origin.code, "passport") : null;
}

/**
 * The saved passport dates as a deadline of the journey. Shows nothing until a passport has been
 * scanned. `only` limits it to some states (Home shows it only when the passport needs action).
 */
export function JourneyPassport({ more, level = 2, only }: { more?: { href: string; label: string }; level?: 2 | 3; only?: Status[] }) {
  const state = useJourney();
  const check = state.passport;
  if (!check || (only && !only.includes(check.status))) return null;
  const route = state.destination?.visa_routes.find((r) => r.id === state.journey?.answers.route_id) ?? null;
  return <PassportStatus check={check} route={state.plan?.route?.name ?? null} today={localToday()} sources={passportSources(route)} guideHref={passportGuide(state.origin)} more={more} level={level} compact />;
}
