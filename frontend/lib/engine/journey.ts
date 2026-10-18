// The personal journey: from "I got an offer" to the first week abroad.
//
// Two things, kept apart on purpose:
//  - the PLAN is built fresh from the country packs every time (stages, steps, who does each one,
//    official links). When the team verifies or corrects a pack, every person's plan updates.
//  - the JOURNEY is what a person saved: their three answers and the status of each step by id.
//
// Pure functions over plain objects: no storage, no network, no clock unless one is passed in.

import type { Actor, ChecklistItem, ContentStatus, CountryPack, SourceRef, Translations, VisaRoute, VisaStep } from "@/lib/types";
import { localized, resolveDocument } from "./packs";

export type JourneyPurpose = "work" | "study" | "explore";
export type ItemStatus = "todo" | "doing" | "done" | "skipped";
export type StageId = "explore" | "before" | "documents" | "visa" | "departure" | "arrival";
export type Who = "you" | "employer" | "university" | "government" | "recruiter";

/** The three answers from the start screens. */
export interface JourneyAnswers {
  purpose: JourneyPurpose;
  /** Country the person lives in now. null = a country we have no pack for. */
  origin: string | null;
  /** null = not decided yet. */
  destination: string | null;
  route_id: string | null;
}

/** What is stored for one person (journeys/{uid} in Firestore, or on the phone for a guest). */
export interface Journey {
  owner_id: string;
  version: 1;
  answers: JourneyAnswers;
  items: Record<string, { status: ItemStatus; updated_at: string }>;
  /** When each stage was first completed. This is the date printed on its DONE stamp. */
  stage_done_at: Partial<Record<StageId, string>>;
  created_at: string;
  updated_at: string;
}

/** Steps a person does inside this app. Their words live in the interface dictionaries. */
export type AppAction = "checkOffer" | "checkAdmission" | "checkAgent" | "cost" | "readiness" | "eligibility" | "interview" | "vaultCopies" | "helpContacts";

const APP_HREF: Record<AppAction, string> = {
  checkOffer: "/check",
  checkAdmission: "/check",
  checkAgent: "/recruiters",
  cost: "/cost",
  readiness: "/documents/scan",
  eligibility: "/eligibility",
  interview: "/interview",
  vaultCopies: "/vault",
  helpContacts: "/sos",
};

export interface PlanItem {
  /** Stable across sessions and pack updates, for example "step:sa-work:medical". */
  id: string;
  stage: StageId;
  kind: "app" | "document" | "step" | "checklist";
  /** Set for app steps: the screen shows the dictionary strings `app.<action>` and `app.<action>.d`. */
  app?: AppAction;
  /** Text from the pack, already in the reader's language where a translation exists. Empty for app steps. */
  title: string;
  description: string;
  who: Who;
  /** In-app screen for this step, without the language prefix. */
  href: string | null;
  official_url: string | null;
  sources: SourceRef[];
  /** "app" = our own screen, nothing to verify. Otherwise the status of the pack content shown. */
  content: ContentStatus | "app";
  last_verified: string | null;
  typical_duration: string | null;
  /** The document guide to open, when the step is about getting a paper. */
  document: { country: string; id: string } | null;
  /** False when the text is still English because this language has no translation for it yet. */
  translated: boolean;
}

export interface PlanStage {
  id: StageId;
  items: PlanItem[];
}

export interface JourneyPlan {
  answers: JourneyAnswers;
  stages: PlanStage[];
  /** Flat list in journey order. */
  items: PlanItem[];
  route: { id: string; name: string; status: ContentStatus } | null;
  /** True when we have the person's home country, so home-country steps are real and not generic. */
  origin_known: boolean;
}

/** The slice of data/pack-index.json the builder needs: names of document guides in every pack. */
export interface PackIndexEntry {
  code: string;
  name: string;
  kind: "origin" | "destination" | "both";
  status: ContentStatus;
  currency?: string | null;
  i18n?: Translations;
  documents: { id: string; title: string; i18n?: Translations }[];
  /** `interview_topics` is how many topics the route's pack has for interview practice. */
  routes: { id: string; name: string; purpose: VisaRoute["purpose"]; status: ContentStatus; interview_topics?: number; i18n?: Translations }[];
}

const WHO: Record<Actor, Who> = { worker: "you", employer: "employer", recruiter: "recruiter", government: "government", university: "university" };

function appItem(stage: StageId, app: AppAction): PlanItem {
  return {
    id: `app:${app}`,
    stage,
    kind: "app",
    app,
    title: "",
    description: "",
    who: "you",
    href: APP_HREF[app],
    official_url: null,
    sources: [],
    content: "app",
    last_verified: null,
    typical_duration: null,
    document: null,
    translated: true,
  };
}

const has = (item: { i18n?: Translations }, locale: string, field: string) => locale === "en" || Boolean(item.i18n?.[locale]?.[field]);

function stepItem(route: VisaRoute, raw: VisaStep, stage: StageId, locale: string): PlanItem {
  const step = localized(raw, locale);
  return {
    id: `step:${route.id}:${raw.id ?? `s${raw.order}`}`,
    stage,
    kind: "step",
    title: step.title,
    description: step.description,
    who: WHO[raw.who] ?? "you",
    href: null,
    official_url: raw.official_url ?? null,
    sources: route.sources,
    content: route.status,
    last_verified: route.last_verified ?? null,
    typical_duration: step.typical_duration ?? null,
    document: null,
    translated: has(raw, locale, "title"),
  };
}

function checklistItem(pack: CountryPack, raw: ChecklistItem, stage: StageId, prefix: string, locale: string, origin: CountryPack | null, destination: CountryPack | null): PlanItem {
  const item = localized(raw, locale);
  const doc = raw.document_id ? resolveDocument(raw.document_id, origin, destination) : null;
  return {
    id: `${prefix}:${pack.code}:${raw.id}`,
    stage,
    kind: "checklist",
    title: item.title,
    description: item.description,
    who: WHO[raw.who ?? "worker"],
    href: null,
    official_url: raw.official_url ?? null,
    // A checklist item has a link but no source record of its own, so its source is the official
    // page of the pack it comes from.
    sources: raw.official_url ? pack.official_sources.filter((s) => s.url === raw.official_url) : [],
    content: pack.status,
    last_verified: pack.last_verified ?? null,
    typical_duration: null,
    document: doc ? { country: doc.country, id: doc.guide.id } : null,
    translated: has(raw, locale, "title"),
  };
}

/**
 * Build the plan for a set of answers.
 *
 * `origin` and `destination` are the full packs for the two countries (null when we have none);
 * `index` is the small all-countries index, used to name a paper whose guide we do not have for
 * this person's country. `locale` picks translations where the packs carry them.
 */
export function buildPlan(answers: JourneyAnswers, origin: CountryPack | null, destination: CountryPack | null, index: PackIndexEntry[] = [], locale = "en"): JourneyPlan {
  const route = destination?.visa_routes.find((r) => r.id === answers.route_id) ?? null;
  const stages: PlanStage[] = [];
  const push = (id: StageId, items: PlanItem[]) => {
    if (items.length) stages.push({ id, items });
  };

  if (answers.purpose === "explore") {
    push("explore", [appItem("explore", "eligibility"), appItem("explore", "checkAgent"), appItem("explore", "cost")]);
  } else if (answers.purpose === "study") {
    push("before", [appItem("before", "checkAdmission"), appItem("before", "cost")]);
  } else {
    push("before", [appItem("before", "checkOffer"), appItem("before", "checkAgent"), appItem("before", "cost")]);
  }

  if (route && destination) {
    // ---- Documents: one item per guide the route names. ----
    const documents: PlanItem[] = [];
    for (const id of route.document_ids ?? []) {
      const found = resolveDocument(id, origin, destination);
      if (found) {
        const guide = localized(found.guide, locale);
        documents.push({
          id: `doc:${id}`,
          stage: "documents",
          kind: "document",
          title: guide.title,
          description: guide.summary ?? "",
          who: "you",
          href: null,
          official_url: found.guide.official_url ?? null,
          sources: found.guide.sources,
          content: found.guide.status,
          last_verified: found.guide.last_verified ?? null,
          typical_duration: guide.typical_time ?? null,
          document: { country: found.country, id },
          translated: has(found.guide, locale, "title"),
        });
        continue;
      }
      // We know the route needs this paper but have no guide for this person's country. Name it
      // (from any pack that defines it) and say nothing more than that.
      const named = index.flatMap((p) => p.documents).find((d) => d.id === id);
      if (named) {
        documents.push({
          id: `doc:${id}`,
          stage: "documents",
          kind: "document",
          title: localized(named, locale).title,
          description: "",
          who: "you",
          href: null,
          official_url: null,
          sources: [],
          content: "draft",
          last_verified: null,
          typical_duration: null,
          document: null,
          translated: has(named, locale, "title"),
        });
      }
    }
    if (!documents.length) {
      // Routes without guide ids yet: fall back to the plain list of papers the route names.
      const names = localized(route, locale).documents;
      route.documents.forEach((_, i) =>
        documents.push({
          id: `paper:${route.id}:${i}`,
          stage: "documents",
          kind: "document",
          title: names[i],
          description: "",
          who: "you",
          href: null,
          official_url: null,
          sources: route.sources,
          content: route.status,
          last_verified: route.last_verified ?? null,
          typical_duration: null,
          document: null,
          translated: has(route, locale, "documents"),
        }),
      );
    }
    if (documents.length && answers.purpose !== "explore") documents.push(appItem("documents", "readiness"));
    push("documents", documents);

    // ---- Visa steps. ----
    const byStage = (stage: "visa" | "departure" | "arrival") => route.steps.filter((s) => (s.stage ?? "visa") === stage).sort((a, b) => a.order - b.order);
    const visa = byStage("visa").map((s) => stepItem(route, s, "visa", locale));
    if (visa.length && (route.interview_topics?.length ?? 0) > 0) visa.push(appItem("visa", "interview"));
    push("visa", visa);

    // A checklist item can be for certain kinds of route only (a worker's emigration registration
    // is not for students).
    const applies = (c: ChecklistItem) => !c.purposes?.length || c.purposes.includes(route.purpose);

    // ---- Before you fly: the home country's own checklist when we have it, else the route's short version. ----
    const homeList = (origin?.departure_checklist ?? []).filter(applies);
    if (origin && homeList.length) {
      push(
        "departure",
        homeList.map((c) => checklistItem(origin, c, "departure", "depart", locale, origin, destination)),
      );
    } else {
      push("departure", [...byStage("departure").map((s) => stepItem(route, s, "departure", locale)), appItem("departure", "vaultCopies")]);
    }

    // ---- First week there. ----
    const arrivalList = (destination.arrival_checklist ?? []).filter(applies);
    const arrival = arrivalList.length
      ? arrivalList.map((c) => checklistItem(destination, c, "arrival", "arrive", locale, origin, destination))
      : byStage("arrival").map((s) => stepItem(route, s, "arrival", locale));
    push("arrival", [...arrival, appItem("arrival", "helpContacts")]);
  }

  return {
    answers,
    stages,
    items: stages.flatMap((s) => s.items),
    route: route ? { id: route.id, name: localized(route, locale).name, status: route.status } : null,
    origin_known: Boolean(origin),
  };
}

// ---- The saved journey ------------------------------------------------------------------------------

const isoNow = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

export function newJourney(ownerId: string, answers: JourneyAnswers, now = isoNow()): Journey {
  return { owner_id: ownerId, version: 1, answers, items: {}, stage_done_at: {}, created_at: now, updated_at: now };
}

/** New answers, same person. Ticks are kept for every step that still exists under the new answers. */
export function changeAnswers(journey: Journey, answers: JourneyAnswers, now = isoNow()): Journey {
  return { ...journey, answers, stage_done_at: {}, updated_at: now };
}

export const statusOf = (journey: Journey | null, itemId: string): ItemStatus => journey?.items[itemId]?.status ?? "todo";

/** Done and "not needed" both count as dealt with. */
export const isResolved = (status: ItemStatus) => status === "done" || status === "skipped";

function stageComplete(stage: PlanStage, journey: Journey): boolean {
  return stage.items.length > 0 && stage.items.every((i) => isResolved(statusOf(journey, i.id)));
}

/**
 * Set one step's status. Also keeps the stage stamps honest: a stage gets its date the moment its
 * last step is dealt with, and loses it again if a step is reopened.
 */
export function setItemStatus(journey: Journey, plan: JourneyPlan, itemId: string, status: ItemStatus, now = isoNow()): Journey {
  if (!plan.items.some((i) => i.id === itemId)) return journey;
  const next: Journey = {
    ...journey,
    items: { ...journey.items, [itemId]: { status, updated_at: now } },
    stage_done_at: { ...journey.stage_done_at },
    updated_at: now,
  };
  for (const stage of plan.stages) {
    if (stageComplete(stage, next)) next.stage_done_at[stage.id] ??= now;
    else delete next.stage_done_at[stage.id];
  }
  return next;
}

/** Recompute stage stamps for a plan, for example after the packs or the answers changed. */
export function syncStages(journey: Journey, plan: JourneyPlan, now = isoNow()): Journey {
  const stage_done_at: Journey["stage_done_at"] = {};
  for (const stage of plan.stages) {
    if (stageComplete(stage, journey)) stage_done_at[stage.id] = journey.stage_done_at[stage.id] ?? now;
  }
  const same = JSON.stringify(stage_done_at) === JSON.stringify(journey.stage_done_at);
  return same ? journey : { ...journey, stage_done_at };
}

// ---- Progress ---------------------------------------------------------------------------------------

/** While a check still carries a red stamp, the score cannot rise above this. */
export const RED_FLAG_CAP = 40;

export type ProgressReason =
  | { kind: "done"; done: number; total: number }
  | { kind: "waiting"; n: number }
  | { kind: "red"; cap: number }
  | { kind: "draft"; n: number };

export interface Progress {
  done: number;
  total: number;
  /** 0 to 100. Share of steps dealt with, capped while a red stamp is open. */
  score: number;
  /** Why the score is what it is, in the order a person should read it. */
  reasons: ProgressReason[];
  /** The first step not yet dealt with, in journey order. null when everything is done. */
  next: PlanItem | null;
  /** Position of `next` counting from 1. */
  nextNumber: number;
  stages: { id: StageId; status: ItemStatus; done: number; total: number; done_at: string | null }[];
}

/**
 * A simple score that can always explain itself.
 * `openRedChecks` is the number of the person's document checks that ended with a red stamp and
 * have not been cleared since.
 */
export function progress(plan: JourneyPlan, journey: Journey | null, openRedChecks = 0): Progress {
  const total = plan.items.length;
  const resolved = plan.items.filter((i) => isResolved(statusOf(journey, i.id)));
  const done = resolved.length;
  const open = plan.items.filter((i) => !isResolved(statusOf(journey, i.id)));
  const raw = total ? Math.round((100 * done) / total) : 0;
  const capped = openRedChecks > 0 ? Math.min(raw, RED_FLAG_CAP) : raw;

  const reasons: ProgressReason[] = [{ kind: "done", done, total }];
  const waiting = open.filter((i) => i.who !== "you").length;
  if (waiting) reasons.push({ kind: "waiting", n: waiting });
  if (openRedChecks > 0) reasons.push({ kind: "red", cap: RED_FLAG_CAP });
  const drafts = plan.items.filter((i) => i.content === "draft").length;
  if (drafts) reasons.push({ kind: "draft", n: drafts });

  const nextIndex = plan.items.findIndex((i) => !isResolved(statusOf(journey, i.id)));
  return {
    done,
    total,
    score: capped,
    reasons,
    next: nextIndex >= 0 ? plan.items[nextIndex] : null,
    nextNumber: nextIndex + 1,
    stages: plan.stages.map((stage) => {
      const d = stage.items.filter((i) => isResolved(statusOf(journey, i.id))).length;
      const started = stage.items.some((i) => statusOf(journey, i.id) !== "todo");
      return {
        id: stage.id,
        status: d === stage.items.length ? "done" : started ? "doing" : "todo",
        done: d,
        total: stage.items.length,
        done_at: journey?.stage_done_at[stage.id] ?? null,
      };
    }),
  };
}

// ---- Choices for the start screens ------------------------------------------------------------------

/** Which pack purposes fit each answer to "why are you going". */
const PURPOSES: Record<JourneyPurpose, VisaRoute["purpose"][] | null> = {
  work: ["work", "seasonal", "skilled_migration"],
  study: ["study"],
  explore: null,
};

export function originChoices(index: PackIndexEntry[]): PackIndexEntry[] {
  return index.filter((p) => p.kind !== "destination");
}

/** Destination countries that have at least one route for this purpose. */
export function destinationChoices(index: PackIndexEntry[], purpose: JourneyPurpose): PackIndexEntry[] {
  return index.filter((p) => p.kind !== "origin" && routeChoices(p, purpose).length > 0);
}

export function routeChoices(country: PackIndexEntry, purpose: JourneyPurpose): PackIndexEntry["routes"] {
  const wanted = PURPOSES[purpose];
  return wanted ? country.routes.filter((r) => wanted.includes(r.purpose)) : country.routes;
}

/** Throws nothing: returns the answers made safe against the current packs (unknown codes become null). */
export function cleanAnswers(answers: JourneyAnswers, index: PackIndexEntry[]): JourneyAnswers {
  const origin = originChoices(index).find((p) => p.code === answers.origin?.toUpperCase())?.code ?? null;
  const dest = index.find((p) => p.kind !== "origin" && p.code === answers.destination?.toUpperCase()) ?? null;
  const route = dest ? routeChoices(dest, answers.purpose).find((r) => r.id === answers.route_id)?.id ?? null : null;
  return { purpose: answers.purpose, origin, destination: dest?.code ?? null, route_id: route };
}
