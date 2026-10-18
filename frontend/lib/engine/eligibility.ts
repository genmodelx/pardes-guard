// Eligibility: compare a profile with a visa route's listed requirements. It never says "you are
// eligible"; it says which listed requirements look met, not met or unknown from what was entered.
// Ported from backend/app/services/eligibility.py. Each answer also carries a code (`why`) and the
// values it used, so the screen can say it in the reader's language; the English stays as well.

import type { EligibilityItem, EligibilityResult, EligibilityStatus, Profile, Requirement, TestScore, TestThreshold, VisaRoute } from "@/lib/types";

const FIELD_LABELS: Record<string, string> = {
  age: "age",
  experience_years: "years of experience",
  passport_valid_months: "months of passport validity",
  education_level: "education",
  has_skills_certificate: "skills certificate",
  has_police_clearance: "police clearance",
};

const g = (n: number) => String(Number(n.toFixed(4)));
const testName = (t: string) => t.replace(/_/g, " ");

/** status, English sentence, code, values */
type Answer = [EligibilityStatus, string, string, Record<string, string | number>];

export function evaluateRoute(country: string, route: VisaRoute, profile: Profile): EligibilityResult {
  const items = route.requirements.map((r) => evaluateRequirement(r, profile));
  return {
    country,
    route_id: route.id,
    route_name: route.name,
    items,
    met: items.filter((i) => i.status === "met").length,
    not_met: items.filter((i) => i.status === "not_met").length,
    unknown: items.filter((i) => i.status === "unknown" || i.status === "manual_check").length,
    content_is_draft: route.status !== "verified" || route.requirements.some((r) => r.status !== "verified"),
    disclaimer: "Based only on what you entered. Requirements change; always confirm on the official page before applying.",
  };
}

export function evaluateRequirement(req: Requirement, profile: Profile): EligibilityItem {
  const base = { requirement_id: req.id, title: req.title, sources: req.sources, content_status: req.status };
  const rule = req.rule;
  let result: Answer;
  if (!rule) result = ["manual_check", req.description, "manual", {}];
  else if (rule.type === "range") result = range(rule, profile);
  else if (rule.type === "min_level") result = level(rule, profile);
  else if (rule.type === "language_any_of") result = language(rule.options, profile);
  else result = bool(rule.field, profile);
  return { ...base, status: result[0], explanation: result[1], why: result[2], params: result[3] };
}

const fieldValue = (profile: Profile, field: string) => (profile as unknown as Record<string, unknown>)[field];

function range(rule: { field: string; min?: number | null; max?: number | null }, profile: Profile): Answer {
  const value = fieldValue(profile, rule.field) as number | null | undefined;
  const label = FIELD_LABELS[rule.field] ?? rule.field;
  const field = rule.field;
  if (value == null) return ["unknown", `Add your ${label} to check this.`, "add_field", { field }];
  if (rule.min != null && value < rule.min) return ["not_met", `Needs at least ${g(rule.min)}; you entered ${g(value)}.`, "below_min", { field, min: g(rule.min), value: g(value) }];
  if (rule.max != null && value > rule.max) return ["not_met", `Needs at most ${g(rule.max)}; you entered ${g(value)}.`, "above_max", { field, max: g(rule.max), value: g(value) }];
  return ["met", `Your ${label} (${g(value)}) is within the listed limit.`, "within", { field, value: g(value) }];
}

function level(rule: { field: string; min: string; order: string[] }, profile: Profile): Answer {
  const value = fieldValue(profile, rule.field) as string | null | undefined;
  const label = FIELD_LABELS[rule.field] ?? rule.field;
  const field = rule.field;
  if (value == null) return ["unknown", `Add your ${label} to check this.`, "add_field", { field }];
  if (!rule.order.includes(value) || !rule.order.includes(rule.min)) {
    return ["unknown", `'${value}' can't be compared automatically; check the official page.`, "cant_compare", { value }];
  }
  return rule.order.indexOf(value) >= rule.order.indexOf(rule.min)
    ? ["met", `Your ${label} meets the listed minimum (${rule.min.replace(/_/g, " ")}).`, "level_met", { field, min: rule.min }]
    : ["not_met", `Needs at least ${rule.min.replace(/_/g, " ")}.`, "level_below", { field, min: rule.min }];
}

function bool(field: string, profile: Profile): Answer {
  const value = fieldValue(profile, field) as boolean | null | undefined;
  const label = FIELD_LABELS[field] ?? field;
  if (value == null) return ["unknown", `Tell us whether you have a ${label}.`, "tell_field", { field }];
  return value ? ["met", `You have a ${label}.`, "have_field", { field }] : ["not_met", `A ${label} is required.`, "need_field", { field }];
}

/** [met?, English, code, values]. null means "cannot say yet". */
type ScoreAnswer = [boolean | null, string, string, Record<string, string | number>];

function scoreMeets(t: TestThreshold, s: TestScore): ScoreAnswer {
  const name = testName(t.test);
  const test = t.test;
  const hasThreshold = t.min_overall != null || (t.min_each && Object.keys(t.min_each).length) || t.min_level;
  if (!hasThreshold) return [null, `${name} is accepted, but the score to aim for isn't listed yet.`, "score_not_listed", { test }];
  if (t.min_level) {
    const order = t.level_order ?? [];
    if (!s.level || !order.includes(s.level) || !order.includes(t.min_level)) return [null, `Enter your ${name} level.`, "enter_level", { test }];
    return [order.indexOf(s.level) >= order.indexOf(t.min_level), `${name} ${s.level} vs required ${t.min_level}.`, "level_vs", { test, level: s.level, min: t.min_level }];
  }
  if (t.min_overall != null) {
    if (s.overall == null) return [null, `Enter your overall ${name} score.`, "enter_overall", { test }];
    if (s.overall < t.min_overall) return [false, `Overall ${g(s.overall)} is below ${g(t.min_overall)}.`, "overall_below", { test, value: g(s.overall), min: g(t.min_overall) }];
  }
  if (t.min_each) {
    const missing = Object.keys(t.min_each).filter((k) => !(k in s.components));
    if (missing.length) return [null, `Enter your score for: ${missing.join(", ")}.`, "enter_parts", { test, parts: missing.join(", ") }];
    const low = Object.entries(t.min_each)
      .filter(([k, m]) => s.components[k] < m)
      .map(([k, m]) => `${k} ${g(s.components[k])} < ${g(m)}`);
    if (low.length) return [false, `Below the minimum in: ${low.join("; ")}.`, "parts_below", { test, parts: low.join("; ") }];
  }
  return [true, `Your ${name} scores meet the listed minimum.`, "scores_met", { test }];
}

function language(options: TestThreshold[], profile: Profile): Answer {
  const accepted = options.map((o) => testName(o.test)).join(", ");
  const byTest = new Map(profile.tests.map((t) => [t.test.toUpperCase(), t]));
  const undecided: ScoreAnswer[] = [];
  const failed: ScoreAnswer[] = [];
  for (const option of options) {
    const s = byTest.get(option.test.toUpperCase());
    if (!s) continue;
    const answer = scoreMeets(option, s);
    if (answer[0]) return ["met", answer[1], answer[2], answer[3]];
    (answer[0] === false ? failed : undecided).push(answer);
  }
  if (undecided.length) return ["unknown", undecided.map((a) => a[1]).join(" "), undecided[0][2], undecided[0][3]];
  if (failed.length) return ["not_met", failed.map((a) => a[1]).join(" "), failed[0][2], failed[0][3]];
  return ["unknown", `Add a test result. Accepted: ${accepted}.`, "add_test", { accepted: options.map((o) => o.test).join(", ") }];
}
