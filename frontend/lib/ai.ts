// The app's one door to Gemini.
//
//   GeminiProvider   Firebase AI Logic with the Agent Platform Gemini API (lib/ai-firebase.ts carries the
//                    request). Walks a chain of models, so running out of free quota on one moves
//                    to the next instead of failing.
//   OfflineProvider  answers "off" to everything. Used when the app is built without Firebase, and
//                    in tests. Screens then fall back to rules-only results and template letters.
//
// Gemini reads, extracts, explains and drafts. It never decides a verdict, a fee, an eligibility
// result or a deadline: those come from lib/engine. Whatever a model returns is data, never
// instructions; callers run screenForInjection on extracted text before using it.
//
// This file holds no Firebase code, so the fallback logic is unit-tested with a stand-in transport.

export interface AiFile {
  mimeType: string;
  /** Base64, without the "data:...;base64," prefix. */
  data: string;
}

export type AiPart = { text: string } | { file: AiFile };

/** A plain JSON Schema (type, properties, required, items, enum, nullable...). */
export type JsonSchema = { [key: string]: unknown };

export interface AiRequest {
  /** The task's instruction, from data/prompts.json. */
  system?: string;
  /** What the model should read, in order: text, photos, PDF pages, a voice note. */
  parts: AiPart[];
  /** Lets a screen cancel the request (the person tapped Stop or left the page). */
  signal?: AbortSignal;
}

/**
 * Why there is no answer. Screens turn each into a plain sentence and a next step.
 *   off         no AI in this copy of the app, or the project's AI is not switched on
 *   quota       every model in the chain is out of free quota for now
 *   network     the phone could not reach Google
 *   blocked     the model declined to answer (safety filter)
 *   unreadable  an answer came back but it was not usable
 *   cancelled   the caller aborted the request
 */
export type AiFailure = "off" | "quota" | "network" | "blocked" | "unreadable" | "cancelled";

export type AiOutcome<T> = { ok: true; value: T; model: string } | { ok: false; reason: AiFailure };

export interface AIProvider {
  readonly kind: "gemini" | "offline";
  /** False when this copy of the app has no AI at all. Screens then never offer AI features. */
  readonly enabled: boolean;
  /** Free text: an explanation, a letter, a translation. */
  text(request: AiRequest): Promise<AiOutcome<string>>;
  /** One JSON object in the given shape: fields read from a document or a voice note. */
  json(request: AiRequest & { schema: JsonSchema }): Promise<AiOutcome<Record<string, unknown>>>;
  /** The model's next turn in a conversation, which may ask to call the app's functions. */
  chat(request: ChatRequest): Promise<AiOutcome<ChatTurn>>;
}

// ---- Conversations with the app's functions (the assistant, interview practice in text) -----------

/**
 * One part of a turn. `thoughtSignature` is the opaque value Gemini 3 attaches to its answer; it is
 * sent back unchanged in the next request (lib/ai-chat-wire.ts).
 */
export type ChatPart =
  | { text: string; thoughtSignature?: string }
  | { functionCall: { name: string; args: Record<string, unknown>; id?: string }; thoughtSignature?: string }
  | { functionResponse: { name: string; response: Record<string, unknown>; id?: string } };

export interface ChatTurn {
  role: "user" | "model";
  parts: ChatPart[];
  /** For a model turn: the model that wrote it, since a thought signature only works with that model. */
  model?: string;
}

/** A function the model may ask the app to run. The app runs it and sends the answer back as data. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ChatRequest {
  system: string;
  history: ChatTurn[];
  tools: ToolSpec[];
  signal?: AbortSignal;
}

export interface ChatCall extends ChatRequest {
  model: string;
}

/** Sends a conversation to one model and returns its next turn. Throws on any failure. */
export type ChatTransport = (call: ChatCall) => Promise<ChatTurn>;

// ---- Models ---------------------------------------------------------------------------------------

export interface ModelSpec {
  id: string;
  /** native: the API enforces JSON output. prompt: ask for JSON in the prompt and parse the text. */
  json: "native" | "prompt";
  /** False when the model takes no separate system instruction; it is then put first in the prompt. */
  system: boolean;
}

/**
 * Tried in this order. Both Gemini models are on Firebase AI Logic's model list (October 2026).
 * gemini-3.1-pro-preview is deliberately absent: it is the slow, costly one.
 * Gemma is not on that list for Agent Platform: if the request is refused, the chain simply ends
 * one step earlier (a 400 or 404 moves on to the next model).
 */
export const MODEL_CHAIN: readonly ModelSpec[] = [
  { id: "gemini-3.8-flash", json: "native", system: true },
  { id: "gemini-3.5-flash-lite", json: "native", system: true },
  { id: "gemma-4-31b-it", json: "prompt", system: false },
];

/** One request to one model, as the transport sends it. */
export interface ModelCall {
  model: string;
  system?: string;
  parts: AiPart[];
  /** Set only for models with native JSON output. */
  jsonSchema?: JsonSchema;
  signal?: AbortSignal;
}

/** Sends one call and returns the model's text. Throws on any failure. */
export type Transport = (call: ModelCall) => Promise<string>;

// ---- Reading failures -----------------------------------------------------------------------------

type Fault =
  | { kind: "stop"; reason: AiFailure }
  /** This model cannot answer now; try the next one. `restMs` keeps it out of the chain for a while. */
  | { kind: "next"; because: "quota" | "busy" | "unsupported"; restMs: number };

const MINUTE = 60_000;

/** "34s" or "1.5s" from a google.rpc.RetryInfo detail, in milliseconds. */
function retryDelayMs(details: unknown): number | null {
  if (!Array.isArray(details)) return null;
  for (const d of details) {
    const raw = (d as { retryDelay?: unknown } | null)?.retryDelay;
    const m = typeof raw === "string" ? /^(\d+(?:\.\d+)?)s$/.exec(raw) : null;
    if (m) return Math.ceil(Number(m[1]) * 1000);
  }
  return null;
}

/**
 * Leaves the real error in the browser console (F12 > Console), so a failure that the screen can only
 * call "could not reach" can still be told apart: a wrong model id, a blocked API key, a quota.
 */
function logFailure(model: string, error: unknown): void {
  if ((error as { name?: string } | null)?.name === "AbortError") return;
  const e = (error ?? {}) as { code?: string; message?: string; customErrorData?: { status?: number } };
  console.warn(`Pardes Guard: ${model} failed`, { code: e.code, status: e.customErrorData?.status, message: e.message });
}

/** Decide what a thrown error means. Shapes follow the Firebase AI SDK's AIError (code, customErrorData). */
export function classifyError(error: unknown): Fault {
  const e = (error ?? {}) as { name?: string; code?: string; message?: string; customErrorData?: { status?: number; errorDetails?: unknown } };
  const message = e.message ?? "";
  if (e.name === "AbortError") {
    // The SDK also aborts on its own timeout. That is a network problem, not the person's choice.
    return { kind: "stop", reason: /timeout/i.test(message) ? "network" : "cancelled" };
  }
  if (e.code === "api-not-enabled" || e.code === "no-api-key" || e.code === "no-app-id" || e.code === "no-project-id") return { kind: "stop", reason: "off" };
  if (e.code === "response-error") return { kind: "stop", reason: "blocked" };

  const status = e.customErrorData?.status;
  if (status === 429) {
    // A per-day limit will not come back for hours; a per-minute one returns within a minute or so.
    const daily = /per\s?day/i.test(message);
    return { kind: "next", because: "quota", restMs: daily ? 6 * 60 * MINUTE : (retryDelayMs(e.customErrorData?.errorDetails) ?? MINUTE) };
  }
  if (status === 500 || status === 503) return { kind: "next", because: "busy", restMs: 0 };
  // Unknown model, or the model does not take this kind of input (audio, a schema).
  if (status === 400 || status === 404) return { kind: "next", because: "unsupported", restMs: 0 };
  if (status === 401 || status === 403) return { kind: "stop", reason: "off" };
  // No status at all: the request never got an answer.
  return { kind: "stop", reason: "network" };
}

// ---- JSON out of text -----------------------------------------------------------------------------

/**
 * The first JSON object in a model's text, or null. Handles code fences and words around the
 * object, which models without native JSON output tend to add.
 */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  // Walk to the brace that closes the first one, skipping braces inside strings.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        const value: unknown = JSON.parse(text.slice(start, i + 1));
        return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

const jsonInstruction = (schema: JsonSchema) =>
  `Reply with one JSON object only. No words before or after it, and no code fence. Use null for anything you cannot read. The object must match this JSON Schema:\n${JSON.stringify(schema)}`;

// ---- Providers ------------------------------------------------------------------------------------

export class OfflineProvider implements AIProvider {
  readonly kind = "offline" as const;
  readonly enabled = false;
  async text(): Promise<AiOutcome<string>> {
    return { ok: false, reason: "off" };
  }
  async json(): Promise<AiOutcome<Record<string, unknown>>> {
    return { ok: false, reason: "off" };
  }
  async chat(): Promise<AiOutcome<ChatTurn>> {
    return { ok: false, reason: "off" };
  }
}

export class GeminiProvider implements AIProvider {
  readonly kind = "gemini" as const;
  readonly enabled = true;
  /** Model id to the time (ms) it may be tried again. */
  private resting = new Map<string, number>();

  constructor(
    private transport: Transport,
    private chain: readonly ModelSpec[] = MODEL_CHAIN,
    private now: () => number = Date.now,
    private chatTransport: ChatTransport | null = null,
  ) {}

  /**
   * A conversation turn. Only models that take a system instruction and native function calling
   * are tried (the Gemini models; Gemma is left out). The same quota fallbacks apply.
   */
  async chat(request: ChatRequest): Promise<AiOutcome<ChatTurn>> {
    if (!this.chatTransport) return { ok: false, reason: "off" };
    let sawQuota = false;
    let sawUnreadable = false;
    for (const model of this.chain.filter((m) => m.system && m.json === "native")) {
      if (request.signal?.aborted) return { ok: false, reason: "cancelled" };
      if ((this.resting.get(model.id) ?? 0) > this.now()) {
        sawQuota = true;
        continue;
      }
      try {
        const turn = await this.chatTransport({ ...request, model: model.id });
        if (turn.parts.some((p) => ("text" in p && p.text.trim()) || "functionCall" in p)) return { ok: true, value: turn, model: model.id };
        sawUnreadable = true;
      } catch (error) {
        logFailure(model.id, error);
        const fault = classifyError(error);
        if (fault.kind === "stop") return { ok: false, reason: fault.reason };
        if (fault.because === "quota") sawQuota = true;
        if (fault.restMs > 0) this.resting.set(model.id, this.now() + fault.restMs);
      }
    }
    return { ok: false, reason: sawQuota ? "quota" : sawUnreadable ? "unreadable" : "network" };
  }

  text(request: AiRequest): Promise<AiOutcome<string>> {
    return this.run(request, null, (text) => (text.trim() ? text.trim() : null));
  }

  json(request: AiRequest & { schema: JsonSchema }): Promise<AiOutcome<Record<string, unknown>>> {
    return this.run(request, request.schema, parseJsonObject);
  }

  /** Walk the chain until one model gives a usable answer. */
  private async run<T>(request: AiRequest, schema: JsonSchema | null, read: (text: string) => T | null): Promise<AiOutcome<T>> {
    let sawQuota = false;
    let sawUnreadable = false;

    for (const model of this.chain) {
      if (request.signal?.aborted) return { ok: false, reason: "cancelled" };
      if ((this.resting.get(model.id) ?? 0) > this.now()) {
        sawQuota = true;
        continue;
      }
      try {
        const answer = await this.transport(this.callFor(model, request, schema));
        const value = read(answer);
        if (value !== null) return { ok: true, value, model: model.id };
        sawUnreadable = true; // an answer we cannot use: let the next model try
      } catch (error) {
        logFailure(model.id, error);
        const fault = classifyError(error);
        if (fault.kind === "stop") return { ok: false, reason: fault.reason };
        if (fault.because === "quota") sawQuota = true;
        if (fault.restMs > 0) this.resting.set(model.id, this.now() + fault.restMs);
      }
    }
    // Nothing answered. Quota is the reason worth telling the person: it passes with time.
    return { ok: false, reason: sawQuota ? "quota" : sawUnreadable ? "unreadable" : "network" };
  }

  /** Shape one request for one model: where the instruction goes, and how JSON is asked for. */
  private callFor(model: ModelSpec, request: AiRequest, schema: JsonSchema | null): ModelCall {
    const lead: string[] = [];
    if (request.system && !model.system) lead.push(request.system);
    if (schema && model.json === "prompt") lead.push(jsonInstruction(schema));
    return {
      model: model.id,
      system: model.system ? request.system : undefined,
      parts: lead.length ? [{ text: lead.join("\n\n") }, ...request.parts] : request.parts,
      jsonSchema: schema && model.json === "native" ? schema : undefined,
      signal: request.signal,
    };
  }
}
