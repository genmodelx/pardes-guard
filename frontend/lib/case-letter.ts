// A case letter drafted by Gemini (DRAFT_LETTER) from the case's own facts, in the language the
// worker picks. The template letter from lib/engine/cases is always there first; this only offers a
// better-written one. The worker reads and edits it, approves it, and sends it themselves.

import type { AIProvider, AiFailure } from "@/lib/ai";
import { LETTER_PURPOSE, letterFacts } from "@/lib/engine/cases";
import { screenForInjection } from "@/lib/engine/text";
import { DEFAULT_LANGUAGE_NAME, fillPrompt, wrapUntrusted, type PromptSet } from "@/lib/prompts";
import type { Case, LadderStep } from "@/lib/types";

export const MAX_LETTER_CHARS = 2500;

export type LetterOutcome = { ok: true; text: string; model: string } | { ok: false; reason: AiFailure };

/** Plain text: no Markdown fences, bold marks or headings, and no runs of blank lines. */
export function cleanLetter(raw: string): string {
  return raw
    .replace(/^```[a-z]*\s*|\s*```$/gi, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function draftLetter(c: Case, step: LadderStep, language: string, deps: { ai: AIProvider; prompts: PromptSet; signal?: AbortSignal }): Promise<LetterOutcome> {
  if (!deps.ai.enabled) return { ok: false, reason: "off" };
  const out = await deps.ai.text({
    system: fillPrompt(deps.prompts.DRAFT_LETTER, { language: deps.prompts.languageName(language) ?? DEFAULT_LANGUAGE_NAME, purpose: LETTER_PURPOSE[step.action] }),
    parts: [{ text: wrapUntrusted("case_facts", letterFacts(c)) }],
    signal: deps.signal,
  });
  if (!out.ok) return out;
  const text = cleanLetter(out.value);
  // A letter that is empty, far too long, or reads like instructions to a machine is not offered.
  if (!text || text.length > MAX_LETTER_CHARS || screenForInjection(text).suspected) return { ok: false, reason: "unreadable" };
  return { ok: true, text, model: out.model };
}

/** Links that open the worker's own apps with the letter filled in. Nothing is sent until they send it there. */
export function shareLinks(text: string, subject: string): { whatsapp: string; email: string } {
  return {
    whatsapp: `https://wa.me/?text=${encodeURIComponent(text)}`,
    email: `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`,
  };
}
