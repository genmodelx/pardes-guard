// The case ladder's timers. There is no scheduler on the free plan, so every time the app opens,
// each case moves its next due step to "waiting for your approval" (with a template letter), and
// the cases that changed are saved. Nothing is sent: the person approves and sends each letter.

import { advance } from "@/lib/engine/cases";
import type { DataStore } from "@/lib/store";
import type { Case } from "@/lib/types";

const isoNow = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

export async function advanceCases(store: DataStore, now = isoNow()): Promise<Case[]> {
  const cases = await store.listCases().catch(() => [] as Case[]);
  await Promise.all(cases.filter((c) => advance(c, now)).map((c) => store.saveCase(c).catch(() => undefined)));
  return cases;
}

/** Cases with a letter waiting for approval, newest change first. */
export function casesWaiting(cases: Case[]): { count: number; latest: { id: string; title: string } | null } {
  const waiting = cases.filter((c) => c.ladder.some((s) => s.status === "awaiting_approval")).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return { count: waiting.length, latest: waiting[0] ? { id: waiting[0].id, title: waiting[0].title } : null };
}
