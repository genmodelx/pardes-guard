// The family view: a case's name, status and steps, readable by anyone who has its share code.
// Nothing else of the case is in it: not the summary, the letters or the files (familySnapshot).
//
// With Firebase, a share lives in shares/{code}, which anyone may get but nobody may list, so the
// family member needs no account. Without Firebase it lives on this phone, so the view can only be
// opened on the same phone; the screens say so.

import { cleanShareCode, familySnapshot } from "@/lib/engine/cases";
import { firebaseEnabled } from "@/lib/firebase";
import type { DataStore, StoredShare } from "@/lib/store";
import type { Case, FamilyView } from "@/lib/types";

export function familyView(c: Case): FamilyView {
  const open = c.status !== "resolved" && c.status !== "closed";
  return { ...familySnapshot(c), alerts: c.kind === "emergency" && open ? [{ case_id: c.id, message: "emergency", created_at: c.created_at }] : [] };
}

/** Read a shared case by its code: from Firestore when the app has it, else from this phone. */
export async function readShare(typed: string, local: DataStore | null): Promise<StoredShare | null> {
  const code = cleanShareCode(typed);
  if (code.length < 12) return null;
  if (firebaseEnabled) {
    const { readPublicShare } = await import("@/lib/store-firestore");
    const found = await readPublicShare(code);
    if (found) return found;
  }
  return local ? local.getShare(code) : null;
}

/** Keep the shared view in step with the case after every change. Failing here never blocks the change. */
export async function syncShare(store: DataStore, c: Case): Promise<void> {
  if (!c.family_share_code) return;
  await store.saveShare(c.family_share_code, c.id, familyView(c)).catch(() => undefined);
}
