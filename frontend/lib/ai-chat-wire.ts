// Turns the app's conversation turns into Firebase AI Logic contents, and a model's answer back into
// a turn, keeping Gemini's thought signatures.
//
// Gemini 3 models attach a thought signature to the first function call of each step. The next
// request must send it back, unchanged, in the same part, or the model refuses it with a 400. The
// SDK's own ChatSession keeps the whole answer in its history and so keeps the signature; this app
// builds the history itself (lib/assistant.ts runs the functions), so it has to carry the signature.
//
// A signature only means something to the model that made it. When the chain falls back to another
// model mid-conversation, or an older turn has none, the first function call of that turn gets the
// placeholder Google's thought-signature guide gives for calls the current model did not make.

import type { Content, Part } from "firebase/ai";
import type { ChatPart, ChatTurn } from "@/lib/ai";

export const SKIP_SIGNATURE = "skip_thought_signature_validator";

// thoughtSignature is sent on the wire by the SDK (it strips only `type`), but it is left out of the
// SDK's public Part type, hence the cast.
const withSignature = (part: Part, signature: string | undefined): Part => (signature ? ({ ...part, thoughtSignature: signature } as unknown as Part) : part);

function toWirePart(part: ChatPart, signature?: string): Part {
  if ("text" in part) return withSignature({ type: "text", text: part.text }, signature);
  if ("functionCall" in part) {
    const { name, args, id } = part.functionCall;
    return withSignature({ type: "functionCall", functionCall: { name, args, ...(id ? { id } : {}) } }, signature);
  }
  const { name, response, id } = part.functionResponse;
  return { type: "functionResponse", functionResponse: { name, response, ...(id ? { id } : {}) } };
}

/**
 * The history as contents for `model`. Function results go back with the "user" role, as the SDK
 * itself does for Gemini 3.6 and later (assignRoleToPartsAndValidateSendMessageRequest).
 */
export function toContents(history: readonly ChatTurn[], model: string): Content[] {
  return history.map((turn): Content => {
    if (turn.role !== "model") return { role: "user", parts: turn.parts.map((p) => toWirePart(p)) };
    const own = turn.model === model;
    let firstCall = true;
    const parts = turn.parts.map((p) => {
      const signature = own && "thoughtSignature" in p ? p.thoughtSignature : undefined;
      if (!("functionCall" in p)) return toWirePart(p, signature);
      const sent = signature ?? (firstCall ? SKIP_SIGNATURE : undefined);
      firstCall = false;
      return toWirePart(p, sent);
    });
    return { role: "model", parts };
  });
}

interface RawPart {
  text?: unknown;
  thought?: unknown;
  thoughtSignature?: unknown;
  functionCall?: { name?: unknown; args?: unknown; id?: unknown };
}

/** The model's answer (the first candidate's parts) as a turn: its text and function calls, with signatures. */
export function modelTurnFrom(parts: readonly unknown[] | undefined, model: string): ChatTurn {
  const out: ChatPart[] = [];
  for (const item of parts ?? []) {
    const raw = (item ?? {}) as RawPart;
    const signature = typeof raw.thoughtSignature === "string" && raw.thoughtSignature ? { thoughtSignature: raw.thoughtSignature } : {};
    const call = raw.functionCall;
    if (call && typeof call.name === "string") {
      const args = call.args && typeof call.args === "object" ? (call.args as Record<string, unknown>) : {};
      out.push({ functionCall: { name: call.name, args, ...(typeof call.id === "string" && call.id ? { id: call.id } : {}) }, ...signature });
    } else if (typeof raw.text === "string" && raw.thought !== true) {
      out.push({ text: raw.text, ...signature });
    }
  }
  return { role: "model", model, parts: out };
}
