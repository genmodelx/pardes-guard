// Carries one model call over Firebase AI Logic, with the Agent Platform Gemini API as the backend.
// Agent Platform is billed to the project's Cloud Billing account (and its credits); the Gemini
// Developer API would need its own prepaid balance in AI Studio (see DECISIONS, entry 120).
// Loaded only when a screen first asks the AI for something, so the SDK is not in the first download.
//
// The calls follow the type definitions of firebase 13.0.0 (@firebase/ai 3.0.0). On the live link on
// 17 October 2026, reading a paper through the Agent Platform backend returned 200; the assistant's
// function calling then failed with 400 until the thought signatures were kept (lib/ai-chat-wire.ts).

import type { FunctionDeclaration, ObjectSchemaRequest, Part, SchemaRequest } from "firebase/ai";
import { GeminiProvider, MODEL_CHAIN, OfflineProvider, type AIProvider, type AiPart, type ChatCall, type ChatTransport, type ChatTurn, type ModelCall, type Transport } from "@/lib/ai";
import { modelTurnFrom, toContents } from "@/lib/ai-chat-wire";
import { firebaseEnabled, getFirebaseApp } from "@/lib/firebase";

/** Gemini 3 models on Agent Platform are served from the global endpoint. */
export const AI_LOCATION = "global";

const toPart = (part: AiPart): Part => ("text" in part ? { type: "text", text: part.text } : { type: "inlineData", inlineData: { mimeType: part.file.mimeType, data: part.file.data } });

export const firebaseTransport: Transport = async (call: ModelCall): Promise<string> => {
  const [app, { getAI, getGenerativeModel, AgentPlatformBackend }] = await Promise.all([getFirebaseApp(), import("firebase/ai")]);
  const ai = getAI(app, { backend: new AgentPlatformBackend(AI_LOCATION) });
  const model = getGenerativeModel(ai, {
    model: call.model,
    systemInstruction: call.system,
    // No temperature or penalties: Gemini 3 models ignore the first and reject the second.
    // The schemas (lib/engine/reading.ts) are written in the OpenAPI form responseSchema takes
    // ("nullable", "enum"), not as JSON Schema, so they go in responseSchema.
    generationConfig: call.jsonSchema ? { responseMimeType: "application/json", responseSchema: call.jsonSchema as unknown as SchemaRequest } : undefined,
  });
  const result = await model.generateContent({ contents: [{ role: "user", parts: call.parts.map(toPart) }] }, { signal: call.signal });
  // text() throws an AIError (response-error) when the answer was blocked.
  return result.response.text();
};

/**
 * One turn of a conversation. The history goes out with the thought signatures Gemini sent
 * (lib/ai-chat-wire.ts): without them Agent Platform answered 400 to the request after a function
 * call, on the live link on 17 October 2026.
 */
export const firebaseChatTransport: ChatTransport = async (call: ChatCall): Promise<ChatTurn> => {
  const [app, { getAI, getGenerativeModel, AgentPlatformBackend }] = await Promise.all([getFirebaseApp(), import("firebase/ai")]);
  const ai = getAI(app, { backend: new AgentPlatformBackend(AI_LOCATION) });
  const functionDeclarations: FunctionDeclaration[] = call.tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters as unknown as ObjectSchemaRequest }));
  const model = getGenerativeModel(ai, { model: call.model, systemInstruction: call.system, tools: functionDeclarations.length ? [{ functionDeclarations }] : undefined });
  const result = await model.generateContent({ contents: toContents(call.history, call.model) }, { signal: call.signal });
  const turn: ChatTurn = modelTurnFrom(result.response.candidates?.[0]?.content?.parts, call.model);
  // An empty answer: text() throws the SDK's error when it was blocked, which says why.
  if (!turn.parts.length) result.response.text();
  return turn;
};

let provider: AIProvider | null = null;

/** The provider for this copy of the app: Gemini when Firebase is configured, otherwise offline. */
export function aiProvider(): AIProvider {
  provider ??= firebaseEnabled ? new GeminiProvider(firebaseTransport, MODEL_CHAIN, Date.now, firebaseChatTransport) : new OfflineProvider();
  return provider;
}
