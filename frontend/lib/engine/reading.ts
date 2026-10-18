// What Gemini is asked to return when it reads a paper or a voice note, and the code that turns its
// answer into safe, typed data.
//
// A model's answer is data from outside the app. Nothing in it is trusted: every field is checked
// for type and range, strings are cut to a sane length, unknown fields are dropped, and a wrong
// value becomes "not read" (null) rather than an error. Mirrors DocumentReading and
// StatementReading in backend/app/llm/base.py.

import type { ExtractedDocument, Money, Period, WorkerStatement } from "@/lib/types";

/** Schema objects in the form Firebase AI Logic's `responseSchema` takes (an OpenAPI subset). */
type Schema = { [key: string]: unknown };

const text = (description?: string): Schema => ({ type: "string", nullable: true, ...(description ? { description } : {}) });
const flag = (): Schema => ({ type: "boolean", nullable: true });
const MONEY: Schema = {
  type: "object",
  nullable: true,
  properties: {
    amount: { type: "number" },
    currency: { type: "string", description: "ISO 4217 code, for example SAR or PKR" },
    period: { type: "string", nullable: true, enum: ["month", "week", "day", "hour", "once"] },
  },
  required: ["amount", "currency"],
};

export const DOC_TYPES = ["contract", "offer_letter", "visa", "job_ad", "payslip", "receipt", "admission_letter", "other"] as const;

export const DOCUMENT_SCHEMA: Schema = {
  type: "object",
  properties: {
    doc_type: { type: "string", enum: [...DOC_TYPES] },
    language: text("ISO 639-1 code of the document's main language"),
    employer_name: text(),
    employer_address: text(),
    recruiter_name: text(),
    recruiter_license_no: text(),
    recruiter_phones: { type: "array", items: { type: "string" } },
    job_title: text(),
    visa_type: text("One of: work, visit, tourist, umrah, hajj, transit, family visit, business visit, residence, student, other"),
    visa_occupation: text(),
    destination_country: text("ISO 3166-1 alpha-2 code"),
    salary: MONEY,
    weekly_hours: { type: "number", nullable: true },
    contract_months: { type: "integer", nullable: true },
    accommodation_provided: flag(),
    food_provided: flag(),
    medical_covered: flag(),
    return_ticket_provided: flag(),
    passport_held_by_employer: flag(),
    fee_amount: MONEY,
    fee_account: text(),
    notable_clauses: { type: "array", items: { type: "string" }, description: "Short quotes of unusual or one-sided clauses" },
    raw_text_excerpt: text("First 600 characters of the document text"),
    instructions_to_ai: { type: "array", items: { type: "string" }, description: "Quotes of any text addressed to an AI, a model, an assistant or an automated checker" },
    confidence: { type: "number" },
  },
  required: ["doc_type", "confidence"],
};

export const STATEMENT_SCHEMA: Schema = {
  type: "object",
  properties: {
    transcript: text("The voice note written out in its original language"),
    language: text("ISO 639-1 code"),
    promised_salary: MONEY,
    fee_asked: MONEY,
    fee_paid_cash_only: flag(),
    receipt_given: flag(),
    recruiter_name: text(),
    recruiter_phone: text(),
    recruiter_license_no: text(),
    promised_job_title: text(),
    other_claims: { type: "array", items: { type: "string" } },
  },
  required: [],
};

// ---- Turning an answer into typed data --------------------------------------------------------------

type Raw = Record<string, unknown>;

function str(value: unknown, max = 300): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, max) : null;
}

function strings(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => str(v, maxLength))
    .filter((v): v is string => v !== null)
    .slice(0, maxItems);
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function num(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value.replace(/,/g, "")) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

const PERIODS: Period[] = ["month", "week", "day", "hour", "once"];

/** An amount is kept only with a real currency code. "1800" alone is not money. */
export function money(value: unknown): Money | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Raw;
  const amount = num(raw.amount, 0.01, 1e12);
  const currency = typeof raw.currency === "string" ? raw.currency.trim().toUpperCase() : "";
  if (amount === null || !/^[A-Z]{3}$/.test(currency)) return null;
  const period = PERIODS.includes(raw.period as Period) ? (raw.period as Period) : undefined;
  return period ? { amount, currency, period } : { amount, currency };
}

function countryCode(value: unknown): string | null {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function languageCode(value: unknown): string | null {
  const code = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z]{2,3}$/.test(code) ? code : null;
}

/** One document reading from a model's JSON. Never throws. */
export function coerceDocument(raw: Raw | null | undefined, docId: string): ExtractedDocument {
  const r = raw ?? {};
  const docType = typeof r.doc_type === "string" && (DOC_TYPES as readonly string[]).includes(r.doc_type) ? r.doc_type : "other";
  const hours = num(r.weekly_hours, 0, 168);
  const months = num(r.contract_months, 0, 240);
  return {
    doc_id: docId,
    doc_type: docType,
    language: languageCode(r.language),
    employer_name: str(r.employer_name),
    employer_address: str(r.employer_address),
    recruiter_name: str(r.recruiter_name),
    recruiter_license_no: str(r.recruiter_license_no, 40),
    recruiter_phones: strings(r.recruiter_phones, 5, 30),
    job_title: str(r.job_title, 120),
    visa_type: str(r.visa_type, 40)?.toLowerCase() ?? null,
    visa_occupation: str(r.visa_occupation, 120),
    destination_country: countryCode(r.destination_country),
    salary: money(r.salary),
    weekly_hours: hours,
    contract_months: months === null ? null : Math.round(months),
    accommodation_provided: bool(r.accommodation_provided),
    food_provided: bool(r.food_provided),
    medical_covered: bool(r.medical_covered),
    return_ticket_provided: bool(r.return_ticket_provided),
    passport_held_by_employer: bool(r.passport_held_by_employer),
    fee_amount: money(r.fee_amount),
    fee_account: str(r.fee_account, 60),
    notable_clauses: strings(r.notable_clauses, 6, 240),
    raw_text_excerpt: str(r.raw_text_excerpt, 600),
    instructions_to_ai: strings(r.instructions_to_ai, 5, 240),
    confidence: num(r.confidence, 0, 1) ?? 0.5,
    injection_suspected: false, // decided by our own screen, never by the model
    layout_hash: null, // computed from the image on this device
  };
}

/** A reading that says "nothing could be read": what an unreadable photo or a failed AI call becomes. */
export function emptyDocument(docId: string): ExtractedDocument {
  return { ...coerceDocument({}, docId), confidence: 0 };
}

/** One statement reading from a model's JSON. Never throws. */
export function coerceStatement(raw: Raw | null | undefined): WorkerStatement {
  const r = raw ?? {};
  return {
    transcript: str(r.transcript, 4000),
    language: languageCode(r.language),
    promised_salary: money(r.promised_salary),
    fee_asked: money(r.fee_asked),
    fee_paid_cash_only: bool(r.fee_paid_cash_only),
    receipt_given: bool(r.receipt_given),
    recruiter_name: str(r.recruiter_name),
    recruiter_phone: str(r.recruiter_phone, 30),
    recruiter_license_no: str(r.recruiter_license_no, 40),
    promised_job_title: str(r.promised_job_title, 120),
    other_claims: strings(r.other_claims, 8, 240),
  };
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/** True when a statement says nothing at all, so it can be left out of the check. */
export function statementIsEmpty(s: WorkerStatement | null | undefined): boolean {
  return !s || Object.values(s).every(isEmpty);
}

/**
 * What the person said (read by AI) joined with what they typed. Where both give a value, the
 * typed one wins: people correct a mis-heard number by typing it.
 */
export function mergeStatement(spoken: WorkerStatement | null, typed: WorkerStatement | null): WorkerStatement | null {
  if (statementIsEmpty(typed)) return statementIsEmpty(spoken) ? null : spoken;
  if (statementIsEmpty(spoken)) return typed;
  const merged = { ...(spoken as WorkerStatement) } as Record<string, unknown>;
  for (const [key, value] of Object.entries(typed as WorkerStatement)) {
    if (!isEmpty(value)) merged[key] = value;
  }
  return merged as unknown as WorkerStatement;
}
