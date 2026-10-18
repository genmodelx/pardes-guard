// A case another screen has started (the wage check, for one), handed to the "Open a case" screen.
// The draft is kept for this tab only, under an id that travels in the address (?draft=...), so
// the new-case screen can read it as often as it mounts. It never leaves the phone, and it is
// dropped once the case is opened.

import type { CaseKind } from "@/lib/types";

export interface CaseDraft {
  kind: CaseKind;
  title: string;
  summary: string;
  destination_country?: string | null;
  related_check_id?: string | null;
}

const KEY = "pg.caseDraft.";
const memory = new Map<string, CaseDraft>();

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Keep a draft and return its id for the address. */
export function setCaseDraft(draft: CaseDraft): string {
  const id = Math.random().toString(36).slice(2, 10);
  memory.set(id, draft);
  try {
    session()?.setItem(KEY + id, JSON.stringify(draft));
  } catch {
    // Storage full or blocked: the copy in memory is enough within this visit.
  }
  return id;
}

export function caseDraft(id: string | null): CaseDraft | null {
  if (!id) return null;
  const kept = memory.get(id);
  if (kept) return kept;
  try {
    const raw = session()?.getItem(KEY + id);
    return raw ? (JSON.parse(raw) as CaseDraft) : null;
  } catch {
    return null;
  }
}

export function dropCaseDraft(id: string | null): void {
  if (!id) return;
  memory.delete(id);
  try {
    session()?.removeItem(KEY + id);
  } catch {
    // nothing to clean up
  }
}
