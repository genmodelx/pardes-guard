// A live voice conversation with Gemini through Firebase AI Logic (Live API, preview), used by
// interview practice and the assistant. The Firebase helper startAudioConversation handles the
// microphone, the audio out and interruptions; this file adds the two things it leaves out:
//   - transcripts: the helper reads the session's messages and drops the transcription text, so the
//     session's receive() is wrapped first and every piece of text is passed on (see DECISIONS).
//   - the app's functions: a call from the model runs here and its answer goes back as data.
//
// NOT RUN AGAINST GOOGLE YET: the build environment could not reach any Google host. The calls
// follow the firebase 13.0.0 type definitions. The backend is Agent Platform, like the rest of the
// app's AI (lib/ai-firebase.ts). Agent Platform has no Gemini 3.x Live model, and its 2.5 Live models
// are not served from the global location, so voice uses the 2.5 native-audio model in us-central1
// (Firebase AI Logic's model list, read on 17 October 2026).

import type { AiFailure, ToolSpec } from "@/lib/ai";
import { classifyError } from "@/lib/ai";
import { runTool, type ToolDeps } from "@/lib/assistant-tools";

export const LIVE_MODEL = "gemini-live-2.5-flash-native-audio";
export const LIVE_LOCATION = "us-central1";

export type LiveFailure = AiFailure | "mic-denied" | "no-mic" | "unsupported";

export interface LiveHandle {
  stop: () => Promise<void>;
}

/** The part of a live session this file touches. */
export interface ReceivingSession {
  receive: () => AsyncGenerator<unknown>;
}

type Piece = (who: "you" | "coach", text: string) => void;

/**
 * Wrap a session's receive() so transcription text reaches `onPiece` while the audio helper still
 * gets every message unchanged. `onTurnEnd` fires when the model finishes a turn, and `onEnd` when
 * the messages stop: the connection closed or failed (Google ends long sessions by itself).
 */
export function captureTranscripts(session: ReceivingSession, onPiece: Piece, onTurnEnd?: () => void, onEnd?: () => void): void {
  const original = session.receive.bind(session);
  session.receive = async function* () {
    try {
      for await (const message of original()) {
        const m = message as { type?: string; inputTranscription?: { text?: string }; outputTranscription?: { text?: string }; turnComplete?: boolean };
        if (m.type === "serverContent") {
          if (m.inputTranscription?.text) onPiece("you", m.inputTranscription.text);
          if (m.outputTranscription?.text) onPiece("coach", m.outputTranscription.text);
          if (m.turnComplete) onTurnEnd?.();
        }
        yield message;
      }
    } finally {
      onEnd?.();
    }
  };
}

/** What went wrong, in the words the screens use. */
export function liveFailure(error: unknown): LiveFailure {
  const e = error as { name?: string; code?: string };
  if (e?.name === "NotAllowedError" || e?.name === "SecurityError") return "mic-denied";
  if (e?.name === "NotFoundError" || e?.name === "NotReadableError") return "no-mic";
  if (e?.code === "unsupported") return "unsupported";
  const fault = classifyError(error);
  return fault.kind === "stop" ? fault.reason : fault.because === "quota" ? "quota" : "network";
}

export async function startLive(opts: {
  system: string;
  tools?: ToolSpec[];
  toolDeps?: ToolDeps;
  onPiece: Piece;
  onTurnEnd?: () => void;
  /** A function ran: its name and the answer it gave the model. */
  onTool?: (name: string, response: Record<string, unknown>) => void;
  /** The session ended without being stopped here. Also fires after stop(); ignore it then. */
  onEnd?: () => void;
}): Promise<{ ok: true; handle: LiveHandle } | { ok: false; reason: LiveFailure }> {
  if (typeof window === "undefined" || typeof AudioWorkletNode === "undefined" || !navigator.mediaDevices) return { ok: false, reason: "unsupported" };
  let session: { close: () => Promise<void> } | null = null;
  try {
    const [{ getFirebaseApp }, sdk] = await Promise.all([import("@/lib/firebase"), import("firebase/ai")]);
    const ai = sdk.getAI(await getFirebaseApp(), { backend: new sdk.AgentPlatformBackend(LIVE_LOCATION) });
    const functionDeclarations = (opts.tools ?? []).map((t) => ({ name: t.name, description: t.description, parameters: t.parameters as never }));
    const model = sdk.getLiveGenerativeModel(ai, {
      model: LIVE_MODEL,
      systemInstruction: opts.system,
      generationConfig: { responseModalities: [sdk.ResponseModality.AUDIO], inputAudioTranscription: {}, outputAudioTranscription: {} },
      tools: functionDeclarations.length ? [{ functionDeclarations }] : undefined,
    });
    const live = await model.connect();
    session = live;
    captureTranscripts(live as unknown as ReceivingSession, opts.onPiece, opts.onTurnEnd, opts.onEnd);
    const controller = await sdk.startAudioConversation(live, {
      // The helper sends back one answer per message. When the model asks for several functions at
      // once, the others are sent here, so none is left waiting.
      functionCallingHandler: async (calls) => {
        const answers = await Promise.all(
          calls.map(async (call) => {
            const response = opts.toolDeps ? await runTool({ name: call.name, args: (call.args ?? {}) as Record<string, unknown> }, opts.toolDeps) : { error: "No functions in this conversation." };
            opts.onTool?.(call.name, response);
            return { id: call.id, name: call.name, response };
          }),
        );
        if (answers.length > 1) void live.sendFunctionResponses(answers.slice(1)).catch(() => undefined);
        return answers[0];
      },
    });
    return {
      ok: true,
      handle: {
        stop: async () => {
          await controller.stop().catch(() => undefined);
          await live.close().catch(() => undefined);
        },
      },
    };
  } catch (error) {
    await session?.close().catch(() => undefined);
    return { ok: false, reason: liveFailure(error) };
  }
}
