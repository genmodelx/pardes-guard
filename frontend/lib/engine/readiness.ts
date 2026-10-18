// Are the papers ready? Two checks that code can do once the dates and names are read:
//   - months left on the passport, against the route's own rule when the pack has one;
//   - the name spelled the same way on every paper.
// Gemini only reads the papers (READ_IDENTITY_DOCUMENT). The photos are never stored: only what
// is listed in IdentityReading, which is shown to the person and can be corrected by them. Nothing
// else is read from a paper: no document number, no date of birth.

import type { ContentStatus, SourceRef, VisaRoute } from "@/lib/types";
import { screenForInjection } from "./text";

export const PAPER_KINDS = ["passport", "national_id", "education_certificate", "test_result", "admission_letter", "police_certificate", "medical_certificate", "other"] as const;
export type PaperKind = (typeof PAPER_KINDS)[number];

export interface IdentityReading {
  id: string;
  kind: PaperKind;
  /** As printed, in Latin letters where the paper has them. */
  full_name: string | null;
  /** YYYY-MM-DD */
  expiry_date: string | null;
  /** "ai" when read from a photo, "typed" when the person entered it. */
  source: "ai" | "typed";
  confidence: number;
}

export const IDENTITY_SCHEMA = {
  type: "object",
  properties: {
    doc_kind: { type: "string", enum: [...PAPER_KINDS] },
    full_name: { type: "string", nullable: true },
    expiry_date: { type: "string", nullable: true, description: "YYYY-MM-DD" },
    confidence: { type: "number" },
  },
  required: ["doc_kind", "confidence"],
};

/** A real calendar date in YYYY-MM-DD form, or null. "2027-02-30" is not a date. */
export function isoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d && y >= 1900 && y <= 2200 ? m[0] : null;
}

/** A name as a person would write it, or null: too long, or something other than a name (a sentence aimed at the reader). */
export function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim();
  if (!name || name.length > 80 || /[<>{}[\]\\/@#=_|~^*]|https?:/i.test(name) || screenForInjection(name).suspected) return null;
  return name;
}

/** One reading from a model's JSON. Never throws; a value it cannot trust becomes null. */
export function coerceIdentity(raw: Record<string, unknown> | null | undefined, id: string): IdentityReading {
  const r = raw ?? {};
  const kind = (PAPER_KINDS as readonly string[]).includes(r.doc_kind as string) ? (r.doc_kind as PaperKind) : "other";
  const confidence = typeof r.confidence === "number" && r.confidence >= 0 && r.confidence <= 1 ? r.confidence : 0.5;
  return { id, kind, full_name: cleanName(r.full_name), expiry_date: isoDate(r.expiry_date), source: "ai", confidence };
}

/** The phone's own calendar date, YYYY-MM-DD. Expiry dates are calendar days, not moments. */
export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// ---- Passport --------------------------------------------------------------------------------------

/** Whole calendar months from `from` to `to` (both YYYY-MM-DD). Negative when `to` is earlier. */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  let months = (ty - fy) * 12 + (tm - fm);
  if (months > 0 && td < fd) months -= 1;
  if (months < 0 && td > fd) months += 1;
  return months;
}

/** `date` moved by whole months, clamped to the end of a shorter month (31 Aug minus 6 months is 28 or 29 Feb). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, last);
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface PassportRule {
  /** Months the passport must still be valid, from the route's requirements. */
  months: number;
  title: string;
  sources: SourceRef[];
  status: ContentStatus;
}

/**
 * The route's own passport rule: a requirement with a range rule on passport_valid_months. null
 * when the pack has none, in which case the screen points to the official page instead of a number.
 */
export function passportRule(route: VisaRoute | null): PassportRule | null {
  for (const req of route?.requirements ?? []) {
    const rule = req.rule;
    if (rule?.type === "range" && rule.field === "passport_valid_months" && typeof rule.min === "number" && rule.min > 0) {
      return { months: rule.min, title: req.title, sources: req.sources, status: req.status };
    }
  }
  return null;
}

export type PassportStatus = "missing" | "no-date" | "expired" | "short" | "ok" | "no-rule";

export interface PassportCheck {
  status: PassportStatus;
  expiry: string | null;
  monthsLeft: number | null;
  rule: PassportRule | null;
  /** The last day the passport still meets the rule: renew before this. null without a rule. */
  renewBy: string | null;
}

export function checkPassport(readings: IdentityReading[], route: VisaRoute | null, today: string): PassportCheck {
  const rule = passportRule(route);
  const passport = readings.find((r) => r.kind === "passport");
  if (!passport) return { status: "missing", expiry: null, monthsLeft: null, rule, renewBy: null };
  if (!passport.expiry_date) return { status: "no-date", expiry: null, monthsLeft: null, rule, renewBy: null };
  const expiry = passport.expiry_date;
  const monthsLeft = monthsBetween(today, expiry);
  const renewBy = rule ? addMonths(expiry, -rule.months) : null;
  let status: PassportStatus;
  if (expiry <= today) status = "expired";
  else if (!rule) status = "no-rule";
  else status = monthsLeft >= rule.months ? "ok" : "short";
  return { status, expiry, monthsLeft, rule, renewBy };
}

// ---- Names -----------------------------------------------------------------------------------------

/** Capitals, no accents, no punctuation, single spaces: "Muḥammad  Aḥmed-Khan" becomes "MUHAMMAD AHMED KHAN". */
export function normalizePersonName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export type NameMatch = "same" | "order" | "different";

export interface NameComparison {
  a: IdentityReading;
  b: IdentityReading;
  match: NameMatch;
}

/** How two spellings of a name relate. Same words in another order is reported apart from a real difference. */
export function compareTwoNames(a: string, b: string): NameMatch {
  const na = normalizePersonName(a);
  const nb = normalizePersonName(b);
  if (na === nb) return "same";
  const sort = (s: string) => s.split(" ").sort().join(" ");
  return sort(na) === sort(nb) ? "order" : "different";
}

/** True when the name is in Latin letters, so it can be compared letter by letter with another. */
export const isLatinName = (name: string | null): boolean => Boolean(name && /\p{Script=Latin}/u.test(name));

/**
 * Every paper's name against the passport's (or, without a passport, against the first paper).
 * Papers whose name is not in Latin letters are left out: comparing scripts would only produce noise.
 */
export function compareNames(readings: IdentityReading[]): NameComparison[] {
  const latin = readings.filter((r) => isLatinName(r.full_name));
  const base = latin.find((r) => r.kind === "passport") ?? latin[0];
  if (!base) return [];
  return latin.filter((r) => r !== base).map((r) => ({ a: base, b: r, match: compareTwoNames(base.full_name as string, r.full_name as string) }));
}

// ---- Everything together ---------------------------------------------------------------------------

export interface ReadinessSummary {
  passport: PassportCheck;
  names: NameComparison[];
  /** With two papers or more: the papers whose name could not be compared (none read, or not in Latin letters). */
  notCompared: IdentityReading[];
  /** Other papers whose own printed expiry date has passed. The passport is covered by `passport`. */
  expired: IdentityReading[];
}

export function summarizeReadiness(readings: IdentityReading[], route: VisaRoute | null, today: string): ReadinessSummary {
  const passport = checkPassport(readings, route, today);
  const names = compareNames(readings);
  const notCompared = readings.length > 1 ? readings.filter((r) => !isLatinName(r.full_name)) : [];
  const first = readings.find((r) => r.kind === "passport");
  const expired = readings.filter((r) => r !== first && r.expiry_date !== null && r.expiry_date <= today);
  return { passport, names, notCompared, expired };
}

export interface PassportDeadline {
  /** renew-by: the last day the passport still meets the route's rule. expiry: no rule, so the expiry date itself. */
  kind: "renew-by" | "expiry";
  date: string;
}

/** The date that goes on the journey for the passport, or null when there is none to show. */
export function passportDeadline(check: PassportCheck): PassportDeadline | null {
  if (!check.expiry) return null;
  return check.renewBy ? { kind: "renew-by", date: check.renewBy } : { kind: "expiry", date: check.expiry };
}

// ---- Calendar --------------------------------------------------------------------------------------

/**
 * A Google Calendar link that opens a new all-day event, filled in, for the person to save
 * themselves. Nothing is added to anyone's calendar without that tap.
 */
export function calendarLink(title: string, date: string, details = ""): string {
  const start = date.replace(/-/g, "");
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const end = next.toISOString().slice(0, 10).replace(/-/g, "");
  const params = new URLSearchParams({ action: "TEMPLATE", text: title, dates: `${start}/${end}` });
  if (details) params.set("details", details);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
