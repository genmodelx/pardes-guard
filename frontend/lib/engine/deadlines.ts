// Important dates: the passport date from the readiness scan, the next step of each open case,
// and dates the person adds themselves (a visa appointment, a flight). Code collects and sorts
// them; each can go to Google Calendar through a filled-in link the person saves themselves.

import type { Case } from "@/lib/types";
import type { PassportDeadline } from "./readiness";

/** A date the person added. Kept in their own record. */
export interface OwnDate {
  id: string;
  title: string;
  date: string;
}

export type DeadlineSource = "passport" | "case" | "mine";

export interface Deadline {
  id: string;
  source: DeadlineSource;
  date: string;
  /** For "mine": the person's words. For the others the screen words it from the fields below. */
  title: string | null;
  passportKind?: PassportDeadline["kind"];
  caseId?: string;
  caseTitle?: string;
  stepAction?: string;
  stepName?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_OWN_DATES = 30;

/** Whole days from `today` to `date` (both YYYY-MM-DD). Negative when the date has passed. */
export function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** A date the person typed, cleaned: a title of 1 to 120 characters and a real calendar day. */
export function cleanOwnDate(input: { title: string; date: string }, id: string): OwnDate | null {
  const title = input.title.replace(/\s+/g, " ").trim().slice(0, 120);
  const date = input.date.trim();
  if (!title || !DAY.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return null;
  if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return null; // 2026-02-30
  return { id, title, date };
}

export function collectDeadlines(input: { passport: PassportDeadline | null; cases: Case[]; mine: OwnDate[] }): Deadline[] {
  const out: Deadline[] = [];
  if (input.passport) out.push({ id: "passport", source: "passport", date: input.passport.date, title: null, passportKind: input.passport.kind });
  for (const c of input.cases) {
    if (c.status === "resolved" || c.status === "closed") continue;
    // The next step still to come: the one waiting for the person, else the next scheduled one.
    const step = c.ladder.find((s) => s.status === "awaiting_approval") ?? c.ladder.find((s) => s.status === "scheduled");
    if (!step) continue;
    out.push({ id: `case:${c.id}:${step.index}`, source: "case", date: step.due_at.slice(0, 10), title: null, caseId: c.id, caseTitle: c.title, stepAction: step.action, stepName: step.name });
  }
  for (const d of input.mine) if (DAY.test(d.date)) out.push({ id: `mine:${d.id}`, source: "mine", date: d.date, title: d.title });
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
