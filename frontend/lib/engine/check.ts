// The document check, after the reading: screen, look up the recruiter, apply the rules, mask, and
// build the verdict. Everything here is plain code over plain data, so the same papers always get
// the same stamp. Gemini has no say in any of it. Mirrors backend/app/services/pipeline.py.

import type { CountryPack, ExtractedDocument, RecruiterCheck, Verdict, WorkerStatement } from "@/lib/types";
import type { RecruiterDirectory } from "./recruiters";
import { evaluate, nextStepCodes, nextSteps, score, topReasons, type CheckContext } from "./rules";
import { maskIdentifiers, maskTail, screenForInjection } from "./text";

export const DISCLAIMER =
  "This is information, not legal advice. It flags warning signs; it cannot prove a visa or contract is genuine. Verify with the official office before you pay or sign.";

/** A warning NGO staff published about a recruiter (riskIndex in the store). */
export interface RiskEntry {
  /** 0 to 1. */
  risk: number;
  reasons: string[];
}

/**
 * Mark documents that carry text aimed at an AI or an automated checker. Two signals: our own
 * patterns over every piece of text the reader returned, and any quote the reader itself put in
 * `instructions_to_ai`. Either one is enough.
 */
export function screenDocuments(documents: ExtractedDocument[]): ExtractedDocument[] {
  return documents.map((d) => {
    const quoted = d.instructions_to_ai ?? [];
    const texts = [d.raw_text_excerpt, d.employer_name, d.employer_address, d.recruiter_name, d.job_title, d.visa_occupation, ...d.notable_clauses, ...quoted];
    const suspected = quoted.length > 0 || screenForInjection(texts.filter(Boolean).join("\n")).suspected;
    return { ...d, injection_suspected: suspected };
  });
}

/** Who to look up: what the person said first, then what is printed on the papers. */
export function recruiterQuery(documents: ExtractedDocument[], statement: WorkerStatement | null): { name: string | null; license: string | null } {
  return {
    name: statement?.recruiter_name || documents.find((d) => d.recruiter_name)?.recruiter_name || null,
    license: statement?.recruiter_license_no || documents.find((d) => d.recruiter_license_no)?.recruiter_license_no || null,
  };
}

/** The destination the person chose, or else the first one a paper names. */
export function inferDestination(context: CheckContext, documents: ExtractedDocument[]): string | null {
  return context.destination_country || documents.find((d) => d.destination_country)?.destination_country || null;
}

/**
 * The raw identifiers a check holds, read out BEFORE masking. They are only ever used to build a
 * hashed fraud signal, and only when the person opted in.
 */
export function rawIdentifiers(documents: ExtractedDocument[], statement: WorkerStatement | null) {
  return {
    phones: [...documents.flatMap((d) => d.recruiter_phones), ...(statement?.recruiter_phone ? [statement.recruiter_phone] : [])],
    accounts: documents.map((d) => d.fee_account).filter((a): a is string => Boolean(a)),
    employer: documents.find((d) => d.employer_name)?.employer_name ?? null,
    layouts: documents.map((d) => d.layout_hash).filter((h): h is string => Boolean(h)),
  };
}

/** Look the recruiter up and add any published warning. */
export function checkRecruiter(directory: RecruiterDirectory, query: { name: string | null; license: string | null }, published: RiskEntry | null): RecruiterCheck {
  const result = directory.check(query.name, query.license);
  if (result.status !== "not_checked" && published) {
    result.network_risk = Math.max(0, Math.min(1, published.risk));
    result.network_reasons = published.reasons.slice(0, 5);
  }
  return result;
}

function maskDocument(d: ExtractedDocument): ExtractedDocument {
  return {
    ...d,
    raw_text_excerpt: maskIdentifiers(d.raw_text_excerpt),
    notable_clauses: d.notable_clauses.map((c) => maskIdentifiers(c) ?? ""),
    instructions_to_ai: (d.instructions_to_ai ?? []).map((c) => maskIdentifiers(c) ?? ""),
    recruiter_phones: d.recruiter_phones.map((p) => maskTail(p)),
    fee_account: d.fee_account ? maskTail(d.fee_account) : null,
  };
}

function maskStatement(s: WorkerStatement): WorkerStatement {
  return { ...s, transcript: maskIdentifiers(s.transcript), recruiter_phone: s.recruiter_phone ? maskTail(s.recruiter_phone) : null };
}

export interface AssembleInput {
  checkId: string;
  /** ISO time, to the second. */
  now: string;
  /** Readings that have already been through screenDocuments. */
  documents: ExtractedDocument[];
  statement: WorkerStatement | null;
  context: CheckContext;
  origin: CountryPack | null;
  destination: CountryPack | null;
  recruiter: RecruiterCheck;
  knownFakeLayouts: Set<string>;
}

/**
 * Apply the rules and build the verdict that is shown and stored. Phone and account numbers are
 * masked to their last four characters and long identifiers in quoted text are blanked, so the
 * stored check never holds them in full.
 */
export function assembleVerdict(input: AssembleInput): Verdict {
  const { documents, statement, origin, destination, recruiter } = input;
  const flags = evaluate({ documents, statement, context: input.context, origin, destination, recruiter, knownFakeLayouts: input.knownFakeLayouts });
  const [level, riskScore] = score(flags);
  return {
    check_id: input.checkId,
    created_at: input.now,
    level,
    risk_score: riskScore,
    flags,
    top_reasons: topReasons(flags),
    next_steps: nextSteps(level, flags, origin),
    next_step_codes: nextStepCodes(level, flags),
    recruiter,
    documents: documents.map(maskDocument),
    statement: statement ? maskStatement(statement) : null,
    spoken_summary: null,
    // A stamp that leans on unverified country rules says so.
    content_is_draft: Boolean((destination && destination.status !== "verified") || (origin && origin.status !== "verified")),
    disclaimer: DISCLAIMER,
  };
}
