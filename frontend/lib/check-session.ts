"use client";

// The papers of the last checks, kept in this tab's memory only, so the result screen can offer a
// translation right after a check. Nothing here is ever written to storage: after a reload the
// photos are gone, as promised.

import type { CheckFile } from "@/lib/check-run";

const papers = new Map<string, CheckFile[]>();
const LIMIT = 3;

export function rememberPapers(checkId: string, files: CheckFile[]): void {
  papers.set(checkId, files);
  while (papers.size > LIMIT) papers.delete(papers.keys().next().value as string);
}

export function papersFor(checkId: string): CheckFile[] | null {
  return papers.get(checkId) ?? null;
}

export function forgetPapers(): void {
  papers.clear();
}
