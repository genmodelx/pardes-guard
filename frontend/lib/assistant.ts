// One turn of the assistant in text: the person's message, any of the app's functions the model
// asks for (run here, answers sent back as data), then the model's reply. The reply is shown as
// plain text. The model cannot send, save or change anything: its only tools only read.

import type { AIProvider, AiFailure, ChatPart, ChatTurn } from "@/lib/ai";
import { ASSISTANT_TOOLS, linksIn, runTool, type ToolDeps, type ToolLink } from "@/lib/assistant-tools";
import { screenForInjection } from "@/lib/engine/text";
import { DEFAULT_LANGUAGE_NAME, fillPrompt, type PromptSet } from "@/lib/prompts";

export const MAX_TOOL_ROUNDS = 4;
export const MAX_REPLY_CHARS = 4000;

export interface AssistantDeps {
  ai: AIProvider;
  prompts: PromptSet;
  tools: ToolDeps;
  language: string;
  signal?: AbortSignal;
}

export type AssistantOutcome =
  | { ok: true; reply: string; history: ChatTurn[]; toolsUsed: string[]; links: ToolLink[]; model: string }
  | { ok: false; reason: AiFailure; history: ChatTurn[] };

export function assistantSystem(prompts: PromptSet, language: string): string {
  return fillPrompt(prompts.GUARDIAN_INSTRUCTION, { language: prompts.languageName(language) ?? DEFAULT_LANGUAGE_NAME });
}

/** Plain text for the screen: no Markdown emphasis or headings, no runs of blank lines. */
export function plainReply(raw: string): string {
  return raw
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*\*\s+/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const textOf = (turn: ChatTurn) =>
  turn.parts
    .filter((p): p is { text: string } => "text" in p)
    .map((p) => p.text)
    .join("\n")
    .trim();

export async function assistantTurn(history: ChatTurn[], message: string, deps: AssistantDeps): Promise<AssistantOutcome> {
  const system = assistantSystem(deps.prompts, deps.language);
  const turns: ChatTurn[] = [...history, { role: "user", parts: [{ text: message.slice(0, 4000) }] }];
  const toolsUsed: string[] = [];
  const links = new Map<string, ToolLink>();
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const out = await deps.ai.chat({ system, history: turns, tools: ASSISTANT_TOOLS, signal: deps.signal });
    if (!out.ok) return { ok: false, reason: out.reason, history };
    turns.push(out.value);
    const calls = out.value.parts.filter((p): p is Extract<ChatPart, { functionCall: unknown }> => "functionCall" in p);
    if (!calls.length) {
      const reply = plainReply(textOf(out.value));
      // A reply that reads like instructions to a machine, or runs far too long, is not shown.
      if (!reply || reply.length > MAX_REPLY_CHARS || screenForInjection(reply).suspected) return { ok: false, reason: "unreadable", history };
      return { ok: true, reply, history: turns, toolsUsed, links: [...links.values()], model: out.model };
    }
    const answers: ChatPart[] = [];
    for (const { functionCall } of calls) {
      toolsUsed.push(functionCall.name);
      const response = await runTool(functionCall, deps.tools);
      for (const link of linksIn(response)) if (!links.has(link.url)) links.set(link.url, link);
      answers.push({ functionResponse: { name: functionCall.name, id: functionCall.id, response } });
    }
    turns.push({ role: "user", parts: answers });
  }
  return { ok: false, reason: "unreadable", history };
}
