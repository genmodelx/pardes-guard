// The app's own functions that the assistant (text or voice) may ask to run. Each answer is plain
// data from the app: the licensed list, the country packs, and the same code that runs the
// eligibility and wage screens. The model only reads these answers; it never decides anything.

import type { ToolSpec } from "@/lib/ai";
import { evaluateRoute } from "@/lib/engine/eligibility";
import { routeCosts } from "@/lib/engine/cost";
import type { RecruiterDirectory } from "@/lib/engine/recruiters";
import { checkWage } from "@/lib/engine/wage";
import { EDUCATION_ORDER, type CountryPack, type Profile, type SourceRef } from "@/lib/types";

export interface ToolDeps {
  directory: () => Promise<RecruiterDirectory>;
  loadPack: (code: string | null) => Promise<CountryPack | null>;
}

const str = { type: "string" } as const;
const num = { type: "number" } as const;

export const ASSISTANT_TOOLS: ToolSpec[] = [
  {
    name: "check_recruiter",
    description: "Look up a recruiter (overseas employment promoter) on the licensed list by name, licence number, or both. The answer says whether the list is only a sample.",
    parameters: { type: "object", properties: { name: str, licence: str } },
  },
  {
    name: "route_info",
    description: "The requirements, steps, papers and fees of a visa route, each with its official source and whether our team has verified it. Without route_id, lists the routes of the country.",
    parameters: { type: "object", properties: { country: { type: "string", description: "Two-letter country code, for example SA, GB or PK" }, route_id: str }, required: ["country"] },
  },
  {
    name: "check_eligibility",
    description: "Compare what the person told you with a route's listed requirements. Returns met, not met or unknown for each one. Never a decision.",
    parameters: {
      type: "object",
      properties: {
        country: str,
        route_id: str,
        age: num,
        education_level: { type: "string", enum: [...EDUCATION_ORDER] },
        experience_years: num,
        passport_valid_months: num,
        has_skills_certificate: { type: "boolean" },
        has_police_clearance: { type: "boolean" },
      },
      required: ["country", "route_id"],
    },
  },
  {
    name: "check_wage",
    description: "Compare one month's pay with the contract: short pay, and late pay when the dates are given.",
    parameters: {
      type: "object",
      properties: { contract_amount: num, paid_amount: num, currency: { type: "string", description: "Three-letter code, for example SAR" }, pay_day: num, paid_on: { type: "string", description: "YYYY-MM-DD" }, month: { type: "string", description: "YYYY-MM, the month worked" } },
      required: ["contract_amount", "paid_amount", "currency"],
    },
  },
  {
    name: "help_contacts",
    description: "Where to complain, and the embassy contacts, for one country, from our data. Says so when none have been added.",
    parameters: { type: "object", properties: { country: str }, required: ["country"] },
  },
];

/** A link from the app's own data that an answer drew on, with the date our team last checked it. */
export interface ToolLink extends SourceRef {
  checked: string | null;
}

/**
 * The links in a function's answer: every {title or name, url} in it, each with the nearest
 * `last_verified` above it. The screen shows these under the reply, so a link the person taps
 * always comes from the packs, never from the model's words.
 */
export function linksIn(result: unknown): ToolLink[] {
  const found = new Map<string, ToolLink>();
  const walk = (value: unknown, checked: string | null) => {
    if (Array.isArray(value)) return value.forEach((v) => walk(v, checked));
    if (!value || typeof value !== "object") return;
    const o = value as Record<string, unknown>;
    // An explicit null means "not checked" for everything inside, even under a checked parent.
    const here = "last_verified" in o ? (typeof o.last_verified === "string" ? o.last_verified : null) : checked;
    const title = typeof o.title === "string" ? o.title : typeof o.name === "string" ? o.name : "";
    if (typeof o.url === "string" && /^https:\/\//.test(o.url) && title && !found.has(o.url)) found.set(o.url, { title, url: o.url, checked: here });
    for (const [k, v] of Object.entries(o)) if (k !== "url") walk(v, here);
  };
  walk(result, null);
  return [...found.values()];
}

const text = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const number = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const sources = (list: { title: string; url: string }[] | undefined) => (list ?? []).map((s) => ({ title: s.title, url: s.url }));

export async function runTool(call: { name: string; args: Record<string, unknown> }, deps: ToolDeps): Promise<Record<string, unknown>> {
  try {
    const a = call.args ?? {};
    switch (call.name) {
      case "check_recruiter": {
        const directory = await deps.directory();
        const r = directory.check(text(a.name) || null, text(a.licence) || null);
        return {
          status: r.status,
          firm: r.match ? { name: r.match.name, licence: r.match.license_no, city: r.match.city, status: r.match.status } : null,
          close_matches: r.candidates.map((c) => ({ name: c.name, licence: c.license_no })),
          list_is_sample: r.list_is_sample,
          note: r.list_is_sample ? "This is a fictional sample list, not the official one. Tell the person to check the official list too." : undefined,
        };
      }
      case "route_info": {
        const pack = await deps.loadPack(text(a.country, 2).toUpperCase());
        if (!pack) return { error: "We have no data for that country." };
        const route = pack.visa_routes.find((r) => r.id === text(a.route_id));
        if (!route) return { country: pack.code, routes: pack.visa_routes.map((r) => ({ id: r.id, name: r.name, purpose: r.purpose })) };
        return {
          country: pack.code,
          last_verified: route.last_verified ?? null,
          route: { id: route.id, name: route.name, purpose: route.purpose, status: route.status, last_verified: route.last_verified ?? null },
          requirements: route.requirements.map((q) => ({ title: q.title, description: q.description, status: q.status, sources: sources(q.sources) })),
          steps: route.steps.map((s) => ({ title: s.title, who: s.who })),
          papers: route.documents,
          // A fee has an amount only when it has a source and a checked date.
          fees: routeCosts(route, null).map((f) => ({ item: f.item, amount: f.amount ? `${f.amount.amount} ${f.amount.currency}` : "not checked yet", source: f.source })),
          sources: sources(route.sources),
          note: route.status === "verified" ? undefined : "This route's content is a draft that our team has not verified yet. Say so.",
        };
      }
      case "check_eligibility": {
        const pack = await deps.loadPack(text(a.country, 2).toUpperCase());
        const route = pack?.visa_routes.find((r) => r.id === text(a.route_id));
        if (!pack || !route) return { error: "We have no such route. Use route_info to list the routes first." };
        const profile: Profile = {
          age: number(a.age),
          education_level: (EDUCATION_ORDER as readonly string[]).includes(a.education_level as string) ? (a.education_level as string) : null,
          experience_years: number(a.experience_years),
          passport_valid_months: number(a.passport_valid_months),
          has_skills_certificate: typeof a.has_skills_certificate === "boolean" ? a.has_skills_certificate : null,
          has_police_clearance: typeof a.has_police_clearance === "boolean" ? a.has_police_clearance : null,
          tests: [],
        };
        const result = evaluateRoute(pack.code, route, profile);
        return { route: route.name, items: result.items.map((i) => ({ requirement: i.title, status: i.status, why: i.explanation })), met: result.met, not_met: result.not_met, unknown: result.unknown, note: result.disclaimer };
      }
      case "check_wage": {
        const currency = text(a.currency, 3).toUpperCase();
        const contract = number(a.contract_amount);
        const paid = number(a.paid_amount);
        if (!currency || contract === null || paid === null) return { error: "Both amounts and the currency are needed." };
        const r = checkWage({
          contract_salary: { amount: contract, currency, period: "month" },
          paid: { amount: paid, currency, period: "month" },
          expected_pay_day: number(a.pay_day),
          paid_on: /^\d{4}-\d{2}-\d{2}$/.test(text(a.paid_on)) ? text(a.paid_on) : null,
          period_month: /^\d{4}-\d{2}$/.test(text(a.month)) ? text(a.month) : null,
        });
        return { problems: r.flags.map((f) => ({ title: f.title, explanation: f.explanation })), shortfall: r.shortfall, days_late: r.days_late, suggest_opening_a_case: r.recommend_case };
      }
      case "help_contacts": {
        const pack = await deps.loadPack(text(a.country, 2).toUpperCase());
        if (!pack) return { error: "We have no data for that country." };
        const contacts = [...pack.complaint_channels, ...pack.embassy_contacts];
        return {
          country: pack.code,
          last_verified: pack.last_verified ?? null,
          regulator: pack.regulator,
          complaint_channels: pack.complaint_channels.map((c) => ({ name: c.name, url: c.url })),
          embassy_contacts: pack.embassy_contacts.map((c) => ({ name: c.name, url: c.url })),
          note: contacts.length ? "Only these contacts are in our data. Do not add phone numbers or offices that are not listed." : "No contacts have been added for this country yet. Say so, and point to the SOS screen.",
        };
      }
      default:
        return { error: `There is no function called ${call.name}.` };
    }
  } catch {
    return { error: "That did not work just now." };
  }
}

/** Names of the app's functions as the screen shows them ("Looked at: the licensed list"). */
export const TOOL_KEYS: Record<string, string> = {
  check_recruiter: "assistant.tool.recruiter",
  route_info: "assistant.tool.route",
  check_eligibility: "assistant.tool.eligibility",
  check_wage: "assistant.tool.wage",
  help_contacts: "assistant.tool.contacts",
};
