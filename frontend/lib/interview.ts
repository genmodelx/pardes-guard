// Interview practice. The interviewer's instruction is built from the route's own interview topics
// (never invented ones). The practice runs by voice (lib/live) or by typing (text turns here), and
// ends with a short scorecard read from the transcript. All of it is practice, never a prediction.

import type { AIProvider, AiFailure, ChatTurn } from "@/lib/ai";
import { screenForInjection } from "@/lib/engine/text";
import { DEFAULT_LANGUAGE_NAME, fillPrompt, wrapUntrusted, type PromptSet } from "@/lib/prompts";

export interface TranscriptLine {
  who: "you" | "coach";
  text: string;
}

export type Answered = "yes" | "partly" | "no";

export interface Scorecard {
  topics: { topic: string; answered: Answered; tip: string }[];
  overall: string;
  model: string;
}

export const SCORECARD_SCHEMA = {
  type: "object",
  properties: {
    topics: {
      type: "array",
      items: { type: "object", properties: { topic: { type: "string" }, answered: { type: "string", enum: ["yes", "partly", "no"] }, tip: { type: "string" } }, required: ["topic", "answered", "tip"] },
    },
    overall: { type: "string" },
  },
  required: ["topics", "overall"],
};

const languageName = (prompts: PromptSet, language: string) => prompts.languageName(language) ?? DEFAULT_LANGUAGE_NAME;

export function interviewSystem(prompts: PromptSet, route: string, topics: string[], language: string): string {
  return fillPrompt(prompts.INTERVIEW_INSTRUCTION, { route, topics: topics.map((t, i) => `${i + 1}. ${t}`).join("; "), language: languageName(prompts, language) });
}

/** The opening message that asks the interviewer to begin. It is not shown as the person's words. */
export const START_MESSAGE = "Please start the practice now.";

export type InterviewTurn = { ok: true; reply: string; history: ChatTurn[] } | { ok: false; reason: AiFailure; history: ChatTurn[] };

/** One exchange in text mode. With no answer yet, the interviewer opens. */
export async function interviewTurn(history: ChatTurn[], answer: string | null, deps: { ai: AIProvider; system: string; signal?: AbortSignal }): Promise<InterviewTurn> {
  const turns: ChatTurn[] = [...history, { role: "user", parts: [{ text: (answer ?? START_MESSAGE).slice(0, 2000) }] }];
  const out = await deps.ai.chat({ system: deps.system, history: turns, tools: [], signal: deps.signal });
  if (!out.ok) return { ok: false, reason: out.reason, history };
  const reply = out.value.parts
    .map((p) => ("text" in p ? p.text : ""))
    .join(" ")
    .trim()
    .slice(0, 1500);
  // Text that reads like instructions to a machine is not shown.
  if (!reply || screenForInjection(reply).suspected) return { ok: false, reason: "unreadable", history };
  return { ok: true, reply, history: [...turns, out.value] };
}

/** Join the small pieces a live transcript arrives in into whole lines, one per speaker turn. */
export function addToTranscript(lines: TranscriptLine[], who: TranscriptLine["who"], piece: string): TranscriptLine[] {
  if (!piece) return lines;
  const last = lines[lines.length - 1];
  if (last && last.who === who) return [...lines.slice(0, -1), { who, text: `${last.text}${piece}` }];
  return [...lines, { who, text: piece.trimStart() }];
}

/** The scorecard, from the transcript only. Each topic is matched to the route's own list. */
export async function scoreInterview(lines: TranscriptLine[], route: string, topics: string[], deps: { ai: AIProvider; prompts: PromptSet; language: string; signal?: AbortSignal }): Promise<{ ok: true; card: Scorecard } | { ok: false; reason: AiFailure }> {
  const said = lines.filter((l) => l.text.trim());
  if (!said.some((l) => l.who === "you")) return { ok: false, reason: "unreadable" };
  const transcript = said.map((l) => `${l.who === "you" ? "Applicant" : "Interviewer"}: ${l.text.trim()}`).join("\n");
  const out = await deps.ai.json({
    system: fillPrompt(deps.prompts.INTERVIEW_SCORECARD, { route, topics: topics.join("; "), language: languageName(deps.prompts, deps.language) }),
    parts: [{ text: wrapUntrusted("interview_transcript", transcript.slice(0, 20000)) }],
    schema: SCORECARD_SCHEMA,
    signal: deps.signal,
  });
  if (!out.ok) return out;
  const raw = Array.isArray(out.value.topics) ? (out.value.topics as Record<string, unknown>[]).filter((r) => r && typeof r === "object") : [];
  const same = (a: unknown, b: string) => typeof a === "string" && a.trim().toLowerCase() === b.trim().toLowerCase();
  // Short plain text only; anything that reads like instructions to a machine is dropped.
  const clean = (value: unknown, max: number) => (typeof value === "string" && !screenForInjection(value).suspected ? value.trim().slice(0, max) : "");
  const card: Scorecard = {
    // One line per topic of the route, matched by the topic's words, else by its place in the list.
    topics: topics.map((topic, i) => {
      const r = raw.find((x) => same(x.topic, topic)) ?? raw[i] ?? {};
      const answered = r.answered === "yes" || r.answered === "partly" ? r.answered : "no";
      return { topic, answered, tip: clean(r.tip, 300) };
    }),
    overall: clean(out.value.overall, 600),
    model: out.model,
  };
  return { ok: true, card };
}
