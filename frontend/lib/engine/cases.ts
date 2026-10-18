// Case engine: opens cases, schedules the escalation ladder, and enforces approval gates.
// Nothing leaves the platform without the worker's approval: when a step falls due it only becomes
// "awaiting approval" with a draft; the worker approves (then sends it themselves) or declines.
// Ported from backend/app/services/cases.py. Pure functions over plain objects, so any store works.
// One difference: this build has no way to notify anyone, so an emergency case records only that
// it was opened, and the screen offers a message the worker sends to family themselves.

import type { Case, CaseKind, LadderStep, OpenCaseRequest, Severity, StepAction } from "@/lib/types";
import { maskNumbersInText, randomId } from "./text";

export class CaseError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const SEVERITY_BY_KIND: Record<CaseKind, Severity> = {
  emergency: "high",
  passport_held: "high",
  recruiter_fraud: "high",
  fraud_ring_link: "high",
  wage_short: "medium",
  wage_late: "medium",
  contract_changed: "medium",
  other: "low",
};

export const STEP_NAMES: Record<StepAction, string> = {
  notice_employer: "Formal notice to the employer or recruiter",
  complaint_embassy: "Complaint to the embassy or Community Welfare Attaché",
  handoff_legal_aid: "Hand the case to a legal-aid partner",
  complaint_regulator: "Complaint to the emigration regulator",
};

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const addDays = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");

function actionsFor(kind: CaseKind): StepAction[] {
  if (kind === "recruiter_fraud" || kind === "fraud_ring_link") return ["complaint_regulator", "handoff_legal_aid"];
  if (kind === "emergency") return ["complaint_embassy", "handoff_legal_aid"];
  return ["notice_employer", "complaint_embassy", "handoff_legal_aid"];
}

export function templateDraft(c: Case, step: LadderStep): string {
  const opening: Record<StepAction, string> = {
    notice_employer: "Dear Sir or Madam,\n\nI am writing about my employment.",
    complaint_embassy: "To the Community Welfare Attaché,\n\nI am a worker from my country requesting your help.",
    handoff_legal_aid: "To the legal-aid team,\n\nI would like help with the following case.",
    complaint_regulator: "To the emigration regulator,\n\nI would like to report a recruiter.",
  };
  const evidence = c.evidence_ids.length ? `Evidence: ${c.evidence_ids.length} file(s), each with a verifiable fingerprint, attached.\n` : "";
  return (
    `${opening[step.action]}\n\nIssue: ${maskNumbersInText(c.title)}\n\n${maskNumbersInText(c.summary)}\n\n` +
    `Case reference: ${c.id}\n${evidence}\n` +
    "I request that this is resolved and that I receive a written reply.\n\nRespectfully,\n[Your name]\n[Date]"
  );
}

/** What each letter is for, in the words the letter prompt (DRAFT_LETTER) takes as its purpose. */
export const LETTER_PURPOSE: Record<StepAction, string> = {
  notice_employer: "a formal notice to the employer or recruiter, asking them to put the problem right",
  complaint_embassy: "a complaint to the worker's embassy (the Community Welfare Attaché), asking for help",
  handoff_legal_aid: "a request to a legal-aid organisation to take up the case",
  complaint_regulator: "a complaint to the emigration regulator about a recruiter",
};

/** The facts a drafted letter may use, and nothing else. Sent to the model as untrusted data. */
export function letterFacts(c: Case): string {
  return [
    `Problem: ${c.kind.replace(/_/g, " ")}`,
    `Title: ${maskNumbersInText(c.title)}`,
    `What happened, in the worker's words: ${maskNumbersInText(c.summary)}`,
    `Country where it happened: ${c.destination_country ?? "not stated"}`,
    `Worker's home country: ${c.origin_country}`,
    `Case opened: ${c.created_at.slice(0, 10)}`,
    `Case reference: ${c.id}`,
    `Evidence files attached: ${c.evidence_ids.length}`,
  ].join("\n");
}

export interface OpenResult {
  case: Case;
  /** Message for family members who follow this case, when one should be sent. */
  familyAlert: string | null;
}

export function openCase(ownerId: string, req: OpenCaseRequest, ladderDays: number[] = [0, 7, 14], now = nowIso()): OpenResult {
  const days = ladderDays.length ? ladderDays : [0, 7, 14];
  const ladder: LadderStep[] = actionsFor(req.kind).map((action, i) => ({
    index: i,
    name: STEP_NAMES[action],
    action,
    due_at: addDays(now, days[Math.min(i, days.length - 1)]),
    status: "scheduled",
    draft: null,
    channel: null,
    decided_at: null,
    sent_at: null,
  }));
  const severity = SEVERITY_BY_KIND[req.kind] ?? "low";
  const c: Case = {
    id: randomId("case"),
    owner_id: ownerId,
    kind: req.kind,
    severity,
    status: "open",
    // Numbers are cut to their last four before anything is stored, written into a letter or shared.
    title: maskNumbersInText(req.title),
    summary: maskNumbersInText(req.summary),
    origin_country: (req.origin_country ?? "PK").toUpperCase(),
    destination_country: req.destination_country ? req.destination_country.toUpperCase() : null,
    created_at: now,
    updated_at: now,
    ladder,
    events: [{ at: now, actor: ownerId, kind: "opened", detail: `Case opened: ${req.kind}` }],
    evidence_ids: [...new Set(req.evidence_ids ?? [])],
    related_check_id: req.related_check_id ?? null,
    family_share_code: null,
    needs_human_review: severity === "high",
  };
  let familyAlert: string | null = null;
  if (req.kind === "emergency") {
    c.status = "escalating";
    // Nothing is sent from here: the screen offers this as a message the worker sends themselves.
    familyAlert = "Emergency alert raised. Please contact your family member now.";
    c.events.push({ at: now, actor: ownerId, kind: "emergency", detail: "Emergency case opened" });
  }
  advance(c, now);
  return { case: c, familyAlert };
}

/** Move the next due step to "awaiting approval". One step waits at a time. Returns true if changed. */
export function advance(c: Case, now = nowIso()): boolean {
  if (c.status === "resolved" || c.status === "closed") return false;
  if (c.ladder.some((s) => s.status === "awaiting_approval")) return false;
  for (const step of c.ladder) {
    if (step.status !== "scheduled") continue;
    if (Date.parse(step.due_at) <= Date.parse(now)) {
      step.status = "awaiting_approval";
      step.draft = templateDraft(c, step);
      c.status = "awaiting_approval";
      c.events.push({ at: now, actor: "system", kind: "step_ready", detail: `Ready for your approval: ${step.name}`, step: step.index });
      c.updated_at = now;
      return true;
    }
    return false;
  }
  return false;
}

function stepOf(c: Case, index: number): LadderStep {
  const s = c.ladder[index];
  if (!s) throw new CaseError("No such step", 404);
  return s;
}

function requireOwner(c: Case, userId: string, what: string): void {
  if (c.owner_id !== userId) throw new CaseError(`Only the worker can ${what}`, 403);
}

export function updateDraft(c: Case, index: number, userId: string, text: string, now = nowIso()): Case {
  requireOwner(c, userId, "edit a letter");
  const s = stepOf(c, index);
  if (s.status !== "awaiting_approval") throw new CaseError("This step is not waiting for approval", 409);
  s.draft = text;
  c.updated_at = now;
  return c;
}

export function approveStep(c: Case, index: number, userId: string, now = nowIso()): Case {
  requireOwner(c, userId, "approve sending");
  const s = stepOf(c, index);
  if (s.status !== "awaiting_approval") throw new CaseError("This step is not waiting for approval", 409);
  s.status = "approved";
  s.decided_at = now;
  s.channel = "outbox";
  c.status = "escalating";
  c.events.push({ at: now, actor: userId, kind: "step_approved", detail: `Approved and ready to send: ${s.name}`, step: s.index });
  advance(c, now);
  c.updated_at = now;
  return c;
}

export function markSent(c: Case, index: number, userId: string, channel: string, now = nowIso()): Case {
  requireOwner(c, userId, "record a letter as sent");
  const s = stepOf(c, index);
  if (s.status !== "approved") throw new CaseError("Only an approved step can be marked as sent", 409);
  s.status = "sent";
  s.sent_at = now;
  s.channel = channel.slice(0, 60);
  c.events.push({ at: now, actor: userId, kind: "step_sent", detail: `Sent via ${s.channel}`, step: s.index, channel: s.channel });
  c.updated_at = now;
  return c;
}

export function declineStep(c: Case, index: number, userId: string, now = nowIso()): Case {
  requireOwner(c, userId, "decline");
  const s = stepOf(c, index);
  if (s.status !== "awaiting_approval") throw new CaseError("This step is not waiting for approval", 409);
  s.status = "declined";
  s.decided_at = now;
  c.status = "open";
  c.events.push({ at: now, actor: userId, kind: "step_declined", detail: `Declined: ${s.name}`, step: s.index });
  advance(c, now);
  c.updated_at = now;
  return c;
}

export function resolveCase(c: Case, userId: string, note: string, now = nowIso()): Case {
  requireOwner(c, userId, "resolve the case");
  for (const s of c.ladder) if (s.status === "scheduled" || s.status === "awaiting_approval") s.status = "skipped";
  c.status = "resolved";
  c.needs_human_review = false;
  c.events.push({ at: now, actor: userId, kind: "resolved", detail: note.slice(0, 500) || "Resolved" });
  c.updated_at = now;
  return c;
}

export function markReviewed(c: Case, reviewerId: string, note: string, now = nowIso()): Case {
  c.needs_human_review = false;
  c.events.push({ at: now, actor: reviewerId, kind: "reviewed", detail: note.slice(0, 500) || "Reviewed" });
  c.updated_at = now;
  return c;
}

export function attachEvidence(c: Case, evidenceId: string, now = nowIso()): Case {
  if (!c.evidence_ids.includes(evidenceId)) {
    c.evidence_ids.push(evidenceId);
    c.events.push({ at: now, actor: c.owner_id, kind: "evidence", detail: "Evidence attached" });
  }
  c.updated_at = now;
  return c;
}

/** Letters and digits a person can read out and type without mixing them up: no 0/O, 1/I/L, no lower case. */
const SHARE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** 14 characters from a 31-character alphabet: about 69 bits, far beyond guessing. */
export function newShareCode(): string {
  const buf = new Uint8Array(14);
  crypto.getRandomValues(buf);
  // 248 is the largest multiple of 31 below 256; bytes above it are drawn again so no letter is favoured.
  const out: string[] = [];
  while (out.length < 14) {
    for (const b of buf) if (b < 248 && out.length < 14) out.push(SHARE_ALPHABET[b % 31]);
    crypto.getRandomValues(buf);
  }
  return out.join("");
}

/** A code as someone typed it: spaces, dashes and case do not matter. */
export function cleanShareCode(typed: string): string {
  return typed.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** What a family member may see: progress only, never the summary, letters or evidence. */
export function familySnapshot(c: Case) {
  return {
    title: c.title,
    status: c.status,
    kind: c.kind,
    destination_country: c.destination_country ?? null,
    updated_at: c.updated_at,
    steps: c.ladder.map((s) => ({ name: s.name, status: s.status, action: s.action })),
  };
}
