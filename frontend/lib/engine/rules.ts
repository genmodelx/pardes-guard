// Deterministic red-flag rules. Gemini reads documents; this code decides what counts as a warning
// sign, so every flag is reproducible and testable. Ported from backend/app/services/rules.py.
//
// Each flag carries its English title and explanation (kept for stored checks, letters and the
// tests) and, beside them, the values that explanation was built from (`params`, `variant`,
// `verify`). The screens use those to say the same thing in the reader's language.

import type {
  CountryPack,
  Evidence,
  ExtractedDocument,
  Flag,
  Money,
  RecruiterCheck,
  Severity,
  SourceRef,
  VerdictLevel,
  WorkerStatement,
} from "@/lib/types";
import { findLayoutMatch } from "./forensics";
import { formatAmount, normalizeName, tokenSetRatio } from "./text";

export interface CheckContext {
  origin_country: string;
  destination_country: string | null;
  purpose: "work" | "study" | "visit";
  reply_language: string;
}

export interface RuleInput {
  documents: ExtractedDocument[];
  statement: WorkerStatement | null;
  context: CheckContext;
  origin: CountryPack | null;
  destination: CountryPack | null;
  recruiter: RecruiterCheck | null;
  knownFakeLayouts: Set<string>;
}

export const SEVERITY_ORDER: Record<Severity, number> = { high: 3, medium: 2, low: 1, info: 0 };
const DEFAULT_RED_FLAG_VISAS = ["visit", "tourist", "transit", "umrah", "hajj", "visitor"];
const UNUSUALLY_LONG_WEEK = 60;
const SALARY_TOLERANCE = 0.98;

const ev = (d: ExtractedDocument, field: string, value: unknown): Evidence => ({ doc_id: d.doc_id, field, value: String(value) });

function flag(f: Omit<Flag, "evidence" | "sources"> & Partial<Pick<Flag, "evidence" | "sources">>): Flag {
  return { evidence: [], sources: [], verify_with: null, ...f };
}

const money = (m: Pick<Money, "amount" | "currency">) => `${formatAmount(m.amount)} ${m.currency}`;

function monthly(m: Money): Money | null {
  const factors: Record<string, number | null> = { month: 1, week: 52 / 12, day: 26, hour: null, once: null };
  const factor = factors[m.period ?? "month"];
  if (factor == null) return null;
  return { amount: Math.round(m.amount * factor * 100) / 100, currency: m.currency, period: "month" };
}

function packSources(pack: CountryPack | null): SourceRef[] {
  if (!pack) return [];
  return (pack.labour_rules.sources.length ? pack.labour_rules.sources : pack.official_sources).slice(0, 2);
}

const employmentDocs = (docs: ExtractedDocument[]) => docs.filter((d) => ["contract", "offer_letter", "visa"].includes(d.doc_type));

export function evaluate(inp: RuleInput): Flag[] {
  const flags = [
    ...visaType(inp),
    ...employerConsistency(inp),
    ...jobConsistency(inp),
    ...salary(inp),
    ...passport(inp),
    ...hours(inp),
    ...essentials(inp),
    ...fees(inp),
    ...recruiter(inp),
    ...layout(inp),
    ...injection(inp),
    ...guaranteedVisa(inp),
    ...lowConfidence(inp),
  ];
  return flags.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] || a.code.localeCompare(b.code));
}

function visaType(inp: RuleInput): Flag[] {
  if (inp.context.purpose !== "work") return [];
  const packRed = (inp.destination?.red_flag_visa_types ?? []).map((v) => v.toLowerCase());
  const red = packRed.length ? packRed : DEFAULT_RED_FLAG_VISAS;
  return inp.documents.flatMap((d) => {
    const vt = (d.visa_type ?? "").trim().toLowerCase();
    if (!vt || !red.some((r) => r === vt || vt.includes(r))) return [];
    return [
      flag({
        code: "VISA_TYPE_MISMATCH",
        severity: "high",
        title: "Visit-type visa for a job",
        explanation: `This visa is marked '${d.visa_type}', but you are going for work. Working on a visit or religious visa is illegal in most countries and leaves you with no legal protection.`,
        evidence: [ev(d, "visa_type", d.visa_type)],
        sources: packSources(inp.destination),
        verify_with: "The destination country's official visa platform",
        verify: "visa_platform",
        params: { visa: d.visa_type ?? "" },
      }),
    ];
  });
}

function employerConsistency(inp: RuleInput): Flag[] {
  const named = employmentDocs(inp.documents).filter((d) => d.employer_name);
  if (named.length < 2) return [];
  const [baseDoc, ...rest] = named;
  const base = baseDoc.employer_name as string;
  return rest.flatMap((d) => {
    const name = d.employer_name as string;
    if (tokenSetRatio(normalizeName(base), normalizeName(name)) >= 80) return [];
    return [
      flag({
        code: "EMPLOYER_NAME_MISMATCH",
        severity: "medium",
        title: "Employer name differs between documents",
        explanation: `One document names '${base}', another names '${name}'. Ask which company will employ you and make sure the visa, offer and contract all name the same employer.`,
        evidence: [ev(baseDoc, "employer_name", base), ev(d, "employer_name", name)],
        params: { a: base, b: name },
      }),
    ];
  });
}

function jobConsistency(inp: RuleInput): Flag[] {
  const promised = inp.statement?.promised_job_title;
  if (!promised) return [];
  return inp.documents.flatMap((d) => {
    const onDoc = d.doc_type === "visa" ? d.visa_occupation : d.job_title;
    if (!onDoc || tokenSetRatio(promised.toLowerCase(), onDoc.toLowerCase()) >= 60) return [];
    return [
      flag({
        code: "JOB_TITLE_MISMATCH",
        severity: "medium",
        title: "Job on paper is not the job you were promised",
        explanation: `You were told '${promised}', but the ${d.doc_type.replace(/_/g, " ")} says '${onDoc}'. Workers are sometimes sent abroad as labourers after being promised skilled jobs.`,
        evidence: [ev(d, d.doc_type === "visa" ? "visa_occupation" : "job_title", onDoc)],
        params: { promised, paper: onDoc, doc_type: d.doc_type },
      }),
    ];
  });
}

function salary(inp: RuleInput): Flag[] {
  const out: Flag[] = [];
  const promised = inp.statement?.promised_salary ?? null;
  const minimum = inp.destination?.labour_rules.minimum_monthly_wage ?? null;
  for (const d of inp.documents.filter((x) => ["contract", "offer_letter"].includes(x.doc_type) && x.salary)) {
    const s = d.salary as Money;
    const m = monthly(s);
    if (promised && m) {
      const p = monthly(promised);
      if (p && p.currency === m.currency) {
        if (m.amount < p.amount * SALARY_TOLERANCE) {
          const gap = Math.round(100 * (1 - m.amount / p.amount));
          out.push(
            flag({
              code: "SALARY_BELOW_PROMISE",
              severity: gap >= 10 ? "high" : "medium",
              title: "Salary is lower than promised",
              explanation: `You were promised ${formatAmount(p.amount)} ${p.currency} a month, but the document says ${formatAmount(m.amount)} ${m.currency} (${gap}% less). Do not sign until the written salary matches the promise.`,
              evidence: [ev(d, "salary", `${formatAmount(s.amount)} ${s.currency}/${s.period ?? "month"}`)],
              params: { promised: money(p), paper: money(m), gap },
            }),
          );
        }
      } else if (p) {
        out.push(
          flag({
            code: "SALARY_CURRENCY_DIFFERS",
            severity: "low",
            title: "Promised salary and contract use different currencies",
            explanation: `The promise was in ${p.currency} and the document is in ${m.currency}. Ask for the exact monthly amount in the contract's currency.`,
            evidence: [ev(d, "salary", `${s.amount} ${s.currency}`)],
            params: { promised: p.currency, paper: m.currency },
          }),
        );
      }
    }
    if (minimum && m && minimum.currency === m.currency && m.amount < minimum.amount) {
      out.push(
        flag({
          code: "SALARY_BELOW_MINIMUM",
          severity: "high",
          title: "Salary below the legal minimum",
          explanation: `${formatAmount(m.amount)} ${m.currency} is below the minimum of ${formatAmount(minimum.amount)} ${minimum.currency} listed for this country.`,
          evidence: [ev(d, "salary", `${s.amount} ${s.currency}`)],
          sources: packSources(inp.destination),
          verify_with: "The destination labour ministry",
          verify: "labour_ministry",
          params: { paper: money(m), minimum: money(minimum) },
        }),
      );
    }
  }
  return out;
}

function passport(inp: RuleInput): Flag[] {
  const prohibited = inp.destination?.labour_rules.passport_retention_prohibited;
  return inp.documents
    .filter((d) => d.passport_held_by_employer)
    .map((d) =>
      flag({
        code: "PASSPORT_RETENTION",
        severity: "high",
        title: "Employer would keep your passport",
        explanation:
          "The document lets the employer keep your passport. Without your passport you cannot leave or change jobs. " +
          (prohibited
            ? "This country's rules do not allow employers to keep passports."
            : "Many countries forbid this; check the rule for your destination."),
        evidence: [ev(d, "passport_held_by_employer", true)],
        sources: packSources(inp.destination),
        verify_with: "The destination labour ministry or your embassy",
        verify: "labour_ministry_or_embassy",
        variant: prohibited ? "banned" : "check",
      }),
    );
}

function hours(inp: RuleInput): Flag[] {
  const limit = inp.destination?.labour_rules.max_weekly_hours || null;
  return employmentDocs(inp.documents).flatMap((d) => {
    if (d.weekly_hours == null) return [];
    if (limit && d.weekly_hours > limit) {
      return [
        flag({
          code: "HOURS_ABOVE_LIMIT",
          severity: "medium",
          title: "Working hours above the legal limit",
          explanation: `${Math.round(d.weekly_hours)} hours a week is above the ${Math.round(limit)}-hour limit listed for this country.`,
          evidence: [ev(d, "weekly_hours", d.weekly_hours)],
          sources: packSources(inp.destination),
          params: { hours: Math.round(d.weekly_hours), limit: Math.round(limit) },
        }),
      ];
    }
    if (!limit && d.weekly_hours > UNUSUALLY_LONG_WEEK) {
      return [
        flag({
          code: "HOURS_UNUSUALLY_LONG",
          severity: "medium",
          title: "Very long working week",
          explanation: `${Math.round(d.weekly_hours)} hours a week is unusually long. Ask how overtime is paid.`,
          evidence: [ev(d, "weekly_hours", d.weekly_hours)],
          params: { hours: Math.round(d.weekly_hours) },
        }),
      ];
    }
    return [];
  });
}

function essentials(inp: RuleInput): Flag[] {
  const contracts = inp.documents.filter((d) => ["contract", "offer_letter"].includes(d.doc_type));
  if (!contracts.length) return [];
  const labels: [keyof ExtractedDocument, string][] = [
    ["accommodation_provided", "accommodation"],
    ["food_provided", "food or food allowance"],
    ["medical_covered", "medical cover"],
    ["return_ticket_provided", "return ticket"],
  ];
  const missing: string[] = [];
  const missingFields: string[] = [];
  const evidence: Evidence[] = [];
  for (const [attr, label] of labels) {
    const values = contracts.map((d) => d[attr] as boolean | null | undefined);
    const allNull = values.every((v) => v == null);
    if (allNull || values.some((v) => v === false)) {
      missing.push(label);
      missingFields.push(attr as string);
      evidence.push(ev(contracts[0], attr as string, allNull ? "not stated" : "no"));
    }
  }
  if (!missing.length) return [];
  return [
    flag({
      code: "ESSENTIALS_MISSING",
      severity: missing.length >= 2 ? "medium" : "low",
      title: "Basic terms missing from the contract",
      explanation: `The contract does not clearly give you: ${missing.join(", ")}. Ask for these in writing.`,
      evidence,
      params: { missing: missingFields },
    }),
  ];
}

function fees(inp: RuleInput): Flag[] {
  const out: Flag[] = [];
  const st = inp.statement;
  let fee = st?.fee_asked ?? null;
  if (!fee) fee = inp.documents.find((d) => d.fee_amount)?.fee_amount ?? null;
  const cap = inp.origin?.max_recruitment_fee ?? null;
  const capSource = inp.origin?.max_recruitment_fee_source ? [inp.origin.max_recruitment_fee_source] : [];
  if (fee) {
    if (cap && cap.currency === fee.currency) {
      if (fee.amount > cap.amount) {
        out.push(
          flag({
            code: "FEE_ABOVE_LIMIT",
            severity: "high",
            title: "Fee above the official limit",
            explanation: `You were asked for ${formatAmount(fee.amount)} ${fee.currency}; the official limit is ${formatAmount(cap.amount)} ${cap.currency}. Don't pay more than the limit.`,
            sources: capSource,
            verify_with: inp.origin?.regulator ?? null,
            verify: "regulator",
            params: { asked: money(fee), limit: money(cap) },
          }),
        );
      }
    } else {
      out.push(
        flag({
          code: "FEE_UNVERIFIED",
          severity: "info",
          title: "Check the official fee",
          explanation: `You were asked for ${formatAmount(fee.amount)} ${fee.currency}. Ask the official office what a licensed recruiter is allowed to charge before you pay.`,
          sources: inp.origin?.official_sources.slice(0, 1) ?? [],
          verify_with: inp.origin?.regulator ?? null,
          verify: "regulator",
          params: { asked: money(fee) },
        }),
      );
    }
  }
  if (st?.fee_paid_cash_only) {
    out.push(
      flag({
        code: "CASH_ONLY_FEE",
        severity: "medium",
        title: "Fee asked in cash only",
        explanation: "Asking for cash only leaves no record. Pay through a bank and keep the receipt.",
      }),
    );
  }
  if (st?.receipt_given === false) {
    out.push(
      flag({
        code: "NO_RECEIPT",
        severity: "medium",
        title: "No receipt for money paid",
        explanation: "Ask for a signed receipt with the recruiter's licence number for every payment.",
      }),
    );
  }
  return out;
}

function recruiter(inp: RuleInput): Flag[] {
  const rc = inp.recruiter;
  if (!rc || rc.status === "not_checked") return [];
  const out: Flag[] = [];
  const regulator = inp.origin?.regulator ?? null;
  const src = inp.origin?.official_sources.slice(0, 1) ?? [];
  const sampleNote = rc.list_is_sample ? " (Checked against a sample list; import the official list before launch.)" : "";
  if (rc.status === "not_found") {
    out.push(
      flag({
        code: "RECRUITER_NOT_LICENSED",
        severity: "high",
        title: "Recruiter not found on the licensed list",
        explanation: `'${rc.query_name || rc.query_license}' is not on the licensed list.${sampleNote}`,
        sources: src,
        verify_with: regulator,
        verify: "regulator",
        params: { name: rc.query_name || rc.query_license || "" },
      }),
    );
  } else if (rc.status === "licensed_suspended" || rc.status === "licensed_cancelled") {
    const state = rc.status === "licensed_suspended" ? "suspended" : "cancelled";
    out.push(
      flag({
        code: "RECRUITER_LICENSE_INACTIVE",
        severity: "high",
        title: `Recruiter's licence is ${state}`,
        explanation: `${rc.match?.name ?? "This recruiter"} has a ${state} licence and may not recruit.${sampleNote}`,
        sources: src,
        verify_with: regulator,
        verify: "regulator",
        variant: state,
        params: { name: rc.match?.name ?? "" },
      }),
    );
  } else if (rc.status === "ambiguous") {
    // When the number is on the list under another firm's name, say so plainly: this is how a
    // borrowed licence looks.
    const borrowed = rc.match && rc.query_name && rc.query_license ? { license: rc.match.license_no, holder: rc.match.name, given: rc.query_name } : null;
    out.push(
      flag({
        code: "RECRUITER_IDENTITY_UNCLEAR",
        severity: "medium",
        title: "Recruiter's name and licence don't clearly match",
        explanation: borrowed
          ? `Licence ${borrowed.license} belongs to '${borrowed.holder}', not to '${borrowed.given}'. Someone may be using another firm's licence. Confirm the exact licence number with the office.${sampleNote}`
          : `The name or licence number matches more than one firm, or the number belongs to a firm with a different name. Confirm the exact licence number with the office.${sampleNote}`,
        sources: src,
        verify_with: regulator,
        verify: "regulator",
        variant: borrowed ? "borrowed" : undefined,
        params: borrowed ?? undefined,
      }),
    );
  }
  if (rc.network_risk >= 0.6) {
    out.push(
      flag({
        code: "RECRUITER_NETWORK_RISK",
        severity: rc.network_risk >= 0.8 ? "high" : "medium",
        title: "Other workers reported problems linked to this recruiter",
        explanation: rc.network_reasons.join("; ") || "Linked to reported cases.",
      }),
    );
  }
  return out;
}

function layout(inp: RuleInput): Flag[] {
  return inp.documents
    .filter((d) => findLayoutMatch(d.layout_hash ?? null, inp.knownFakeLayouts))
    .map((d) =>
      flag({
        code: "KNOWN_FAKE_LAYOUT",
        severity: "high",
        title: "Document matches a known fake",
        explanation:
          "This page looks the same as documents other workers reported as fake. Check it on the official platform before paying anything.",
        evidence: [ev(d, "layout_hash", d.layout_hash)],
      }),
    );
}

function injection(inp: RuleInput): Flag[] {
  return inp.documents
    .filter((d) => d.injection_suspected)
    .map((d) =>
      flag({
        code: "HIDDEN_INSTRUCTIONS",
        severity: "medium",
        title: "Document contains text aimed at automated checkers",
        explanation:
          "We found wording that tries to instruct an AI system. We ignored it. Genuine documents do not contain this; treat the document with suspicion.",
        evidence: [ev(d, "injection_suspected", true)],
      }),
    );
}

// "Guaranteed visa", "100% visa", "ویزا کی گارنٹی". Only the destination's government decides a
// visa, so a promise of one is a warning sign wherever it appears: on a paper or in what the agent said.
const GUARANTEE = /guarantee[ds]?\s+(?:(?:a|an|the|your|you|of)\s+)*(?:visa|approval|admission|selection)|(?:visa|approval)\s+(?:is\s+)?(?:100\s*%\s*)?guaranteed|100\s*%\s*(?:visa|guarantee[ds]?)|ویز[اے].{0,24}(?:گارنٹی|ضمانت|یقینی)|(?:گارنٹی|ضمانت).{0,24}ویز[اے]/i;

/** The first sentence-sized piece of text that promises a visa, or null. Exported for tests. */
export function findGuarantee(texts: (string | null | undefined)[]): string | null {
  for (const text of texts) {
    if (!text) continue;
    const m = GUARANTEE.exec(text);
    if (m) {
      // Quote a little around the match so the person can find it on the paper.
      const start = Math.max(0, m.index - 40);
      return text.slice(start, m.index + m[0].length + 40).trim();
    }
  }
  return null;
}

function guaranteedVisa(inp: RuleInput): Flag[] {
  const evidence: Evidence[] = [];
  for (const d of inp.documents) {
    const quote = findGuarantee([...d.notable_clauses, d.raw_text_excerpt]);
    if (quote) evidence.push(ev(d, "notable_clauses", quote));
  }
  const said = findGuarantee([...(inp.statement?.other_claims ?? []), inp.statement?.transcript]);
  if (said) evidence.push({ doc_id: "statement", field: "other_claims", value: said });
  if (!evidence.length) return [];
  return [
    flag({
      code: "VISA_GUARANTEED",
      severity: "medium",
      title: "Promise of a guaranteed visa",
      explanation:
        "The paper or the agent promises that you will get a visa. Only the government of the country decides on a visa, so nobody can guarantee one. Treat this promise as a warning sign.",
      evidence,
    }),
  ];
}

/** Below this a paper is too unclear to stand behind a "looks OK" stamp. */
export const UNREADABLE_BELOW = 0.3;

function lowConfidence(inp: RuleInput): Flag[] {
  return inp.documents
    .filter((d) => d.confidence < 0.5)
    .map((d) =>
      flag({
        code: "UNCLEAR_DOCUMENT",
        // A paper that could hardly be read must not end in a green stamp: nothing was really checked.
        severity: d.confidence < UNREADABLE_BELOW ? "medium" : "info",
        title: "Part of a document was hard to read",
        explanation: "Some values may be wrong. Retake the photo in good light, flat and in focus.",
        evidence: [ev(d, "confidence", d.confidence.toFixed(2))],
      }),
    );
}

// ---- Scoring -------------------------------------------------------------------

const WEIGHTS: Record<Severity, number> = { high: 35, medium: 15, low: 5, info: 0 };

export function score(flags: Flag[]): [VerdictLevel, number] {
  const risk = Math.min(100, flags.reduce((n, f) => n + WEIGHTS[f.severity], 0));
  const level: VerdictLevel = flags.some((f) => f.severity === "high")
    ? "red"
    : flags.some((f) => f.severity === "medium")
      ? "amber"
      : "green";
  return [level, risk];
}

export function nextSteps(level: VerdictLevel, flags: Flag[], origin: CountryPack | null): string[] {
  const codes = new Set(flags.map((f) => f.code));
  const any = (...c: string[]) => c.some((x) => codes.has(x));
  const steps: string[] = [];
  if (level === "red") steps.push("Do not pay or sign anything until the problems below are fixed in writing.");
  if (any("RECRUITER_NOT_LICENSED", "RECRUITER_LICENSE_INACTIVE", "RECRUITER_IDENTITY_UNCLEAR")) {
    steps.push(`Confirm the recruiter's licence number with ${origin?.regulator || "the official emigration office"}.`);
  }
  if (codes.has("VISA_TYPE_MISMATCH")) steps.push("Ask for a work visa. Do not travel to work on a visit or religious visa.");
  if (any("SALARY_BELOW_PROMISE", "JOB_TITLE_MISMATCH", "ESSENTIALS_MISSING")) {
    steps.push("Ask for the promised salary, job and benefits to be written into the contract.");
  }
  if (any("CASH_ONLY_FEE", "NO_RECEIPT", "FEE_ABOVE_LIMIT", "FEE_UNVERIFIED")) {
    steps.push("Pay only through a bank, only the official fee, and keep every receipt.");
  }
  if (codes.has("PASSPORT_RETENTION")) steps.push("Do not agree to give up your passport. Keep it yourself.");
  steps.push("Keep copies of everything in your vault and share them with a family member.");
  return steps;
}

/** The steps of `nextSteps` as codes, for screens that say them in the reader's language (`next.<code>`). */
export type NextStepCode = "holdPayment" | "confirmLicence" | "workVisa" | "writeItDown" | "payByBank" | "keepPassport" | "keepCopies";

export function nextStepCodes(level: VerdictLevel, flags: Flag[]): NextStepCode[] {
  const codes = new Set(flags.map((f) => f.code));
  const any = (...c: string[]) => c.some((x) => codes.has(x));
  const steps: NextStepCode[] = [];
  if (level === "red") steps.push("holdPayment");
  if (any("RECRUITER_NOT_LICENSED", "RECRUITER_LICENSE_INACTIVE", "RECRUITER_IDENTITY_UNCLEAR")) steps.push("confirmLicence");
  if (codes.has("VISA_TYPE_MISMATCH")) steps.push("workVisa");
  if (any("SALARY_BELOW_PROMISE", "JOB_TITLE_MISMATCH", "ESSENTIALS_MISSING")) steps.push("writeItDown");
  if (any("CASH_ONLY_FEE", "NO_RECEIPT", "FEE_ABOVE_LIMIT", "FEE_UNVERIFIED")) steps.push("payByBank");
  if (codes.has("PASSPORT_RETENTION")) steps.push("keepPassport");
  steps.push("keepCopies");
  return steps;
}

export function topReasons(flags: Flag[], limit = 3): string[] {
  return flags.filter((f) => f.severity === "high" || f.severity === "medium").map((f) => f.title).slice(0, limit);
}
