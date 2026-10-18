// The AI provider's fallback logic, tested with a stand-in transport. No network, no Firebase.

import { describe, expect, it } from "vitest";
import { GeminiProvider, MODEL_CHAIN, OfflineProvider, classifyError, parseJsonObject, type ModelCall, type Transport } from "@/lib/ai";

/** An error shaped like the Firebase AI SDK's AIError for an HTTP failure. */
const httpError = (status: number, message = "", errorDetails?: unknown) => Object.assign(new Error(`AI: Error fetching: [${status}] ${message}`), { code: "fetch-error", customErrorData: { status, errorDetails } });

/** A transport that answers from a script: one entry per call, a string to return or an error to throw. */
function scripted(script: (string | Error)[]): { transport: Transport; calls: ModelCall[] } {
  const calls: ModelCall[] = [];
  const transport: Transport = async (call) => {
    calls.push(call);
    const step = script[calls.length - 1];
    if (step === undefined) throw new Error("the test script ran out of answers");
    if (step instanceof Error) throw step;
    return step;
  };
  return { transport, calls };
}

const SCHEMA = { type: "object", properties: { employer_name: { type: "string", nullable: true } } };
const ask = { system: "Read the document.", parts: [{ text: "Offer letter text" }] };

describe("model chain", () => {
  it("tries the two Gemini models, then Gemma", () => {
    expect(MODEL_CHAIN.map((m) => m.id)).toEqual(["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemma-4-31b-it"]);
    expect(MODEL_CHAIN.some((m) => m.id.includes("pro"))).toBe(false);
  });

  it("answers from the first model when it works", async () => {
    const { transport, calls } = scripted(['{"employer_name":"Northstar"}']);
    const out = await new GeminiProvider(transport).json({ ...ask, schema: SCHEMA });
    expect(out).toEqual({ ok: true, value: { employer_name: "Northstar" }, model: "gemini-3.8-flash" });
    expect(calls).toHaveLength(1);
    expect(calls[0].system).toBe("Read the document.");
    expect(calls[0].jsonSchema).toBe(SCHEMA);
  });

  it("moves to the next model on a quota error, and rests the one that ran out", async () => {
    let clock = 1_000_000;
    const { transport, calls } = scripted([httpError(429, "quota exceeded"), "second answer", "third answer"]);
    const ai = new GeminiProvider(transport, MODEL_CHAIN, () => clock);

    const first = await ai.text(ask);
    expect(first).toEqual({ ok: true, value: "second answer", model: "gemini-3.5-flash-lite" });

    // Within the rest time the first model is skipped without a request.
    const second = await ai.text(ask);
    expect(second).toMatchObject({ ok: true, model: "gemini-3.5-flash-lite" });
    expect(calls.map((c) => c.model)).toEqual(["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.5-flash-lite"]);

    // After the rest it is tried again.
    clock += 61_000;
    const { transport: later, calls: laterCalls } = scripted(["fresh"]);
    (ai as unknown as { transport: Transport }).transport = later;
    expect(await ai.text(ask)).toMatchObject({ ok: true, model: "gemini-3.8-flash" });
    expect(laterCalls).toHaveLength(1);
  });

  it("uses the retry delay Google sends, and rests a model for hours on a daily limit", async () => {
    expect(classifyError(httpError(429, "per minute", [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "34s" }]))).toEqual({ kind: "next", because: "quota", restMs: 34_000 });
    const daily = classifyError(httpError(429, "GenerateRequestsPerDayPerProjectPerModel-FreeTier"));
    expect(daily).toMatchObject({ kind: "next", because: "quota" });
    expect((daily as { restMs: number }).restMs).toBeGreaterThan(60 * 60_000);
  });

  it("says quota when every model is out", async () => {
    const { transport, calls } = scripted([httpError(429), httpError(429), httpError(429)]);
    expect(await new GeminiProvider(transport).text(ask)).toEqual({ ok: false, reason: "quota" });
    expect(calls).toHaveLength(3);
  });

  it("asks Gemma for JSON in the prompt and reads it out of the text", async () => {
    const { transport, calls } = scripted([httpError(429), httpError(503), 'Here you go:\n```json\n{"employer_name": "Al Noor {Group}"}\n```\nHope that helps.']);
    const out = await new GeminiProvider(transport).json({ ...ask, schema: SCHEMA });
    expect(out).toEqual({ ok: true, value: { employer_name: "Al Noor {Group}" }, model: "gemma-4-31b-it" });
    const gemma = calls[2];
    expect(gemma.jsonSchema).toBeUndefined();
    expect(gemma.system).toBeUndefined();
    const lead = (gemma.parts[0] as { text: string }).text;
    expect(lead).toContain("Read the document.");
    expect(lead).toContain("JSON Schema");
    expect(lead).toContain("employer_name");
    expect(gemma.parts[1]).toEqual({ text: "Offer letter text" });
  });

  it("tries the next model when an answer is not usable JSON", async () => {
    const { transport, calls } = scripted(["I cannot read this.", '{"employer_name":null}']);
    const out = await new GeminiProvider(transport).json({ ...ask, schema: SCHEMA });
    expect(out).toMatchObject({ ok: true, value: { employer_name: null }, model: "gemini-3.5-flash-lite" });
    expect(calls).toHaveLength(2);
  });

  it("says unreadable when no model gives a usable answer", async () => {
    const { transport } = scripted(["no", "[1,2]", "still no"]);
    expect(await new GeminiProvider(transport).json({ ...ask, schema: SCHEMA })).toEqual({ ok: false, reason: "unreadable" });
  });

  it("skips a model that does not exist or cannot take the input", async () => {
    const { transport, calls } = scripted([httpError(404, "model not found"), "ok"]);
    expect(await new GeminiProvider(transport).text(ask)).toMatchObject({ ok: true, model: "gemini-3.5-flash-lite" });
    expect(calls).toHaveLength(2);
  });

  it("stops at once when AI is not switched on for the project", async () => {
    for (const error of [httpError(403, "permission denied"), Object.assign(new Error("not enabled"), { code: "api-not-enabled" })]) {
      const { transport, calls } = scripted([error, "never used"]);
      expect(await new GeminiProvider(transport).text(ask)).toEqual({ ok: false, reason: "off" });
      expect(calls).toHaveLength(1);
    }
  });

  it("stops on a network failure, a blocked answer and a cancelled request", async () => {
    const cases: [Error, string][] = [
      [Object.assign(new Error("AI: Error fetching: Failed to fetch"), { code: "error" }), "network"],
      [Object.assign(new Error("Text not available. Response was blocked due to SAFETY"), { code: "response-error" }), "blocked"],
      [Object.assign(new Error("Aborted"), { name: "AbortError" }), "cancelled"],
      [Object.assign(new Error("Timeout has expired."), { name: "AbortError" }), "network"],
    ];
    for (const [error, reason] of cases) {
      const { transport, calls } = scripted([error, "never used"]);
      expect(await new GeminiProvider(transport).text(ask)).toEqual({ ok: false, reason });
      expect(calls).toHaveLength(1);
    }
  });

  it("does not send anything once the caller has cancelled", async () => {
    const { transport, calls } = scripted(["never used"]);
    const controller = new AbortController();
    controller.abort();
    expect(await new GeminiProvider(transport).text({ ...ask, signal: controller.signal })).toEqual({ ok: false, reason: "cancelled" });
    expect(calls).toHaveLength(0);
  });

  it("treats an empty text answer as unusable", async () => {
    const { transport } = scripted(["   ", "A real answer."]);
    expect(await new GeminiProvider(transport).text(ask)).toMatchObject({ ok: true, value: "A real answer.", model: "gemini-3.5-flash-lite" });
  });
});

describe("offline provider", () => {
  it("answers off to everything, so screens fall back to rules and templates", async () => {
    const ai = new OfflineProvider();
    expect(ai.enabled).toBe(false);
    expect(await ai.text()).toEqual({ ok: false, reason: "off" });
    expect(await ai.json()).toEqual({ ok: false, reason: "off" });
  });
});

describe("parseJsonObject", () => {
  it("reads a bare object", () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
  });
  it("reads an object inside a code fence with words around it", () => {
    expect(parseJsonObject('Sure.\n```json\n{"a":{"b":"x"}}\n```\nDone.')).toEqual({ a: { b: "x" } });
  });
  it("is not confused by braces and quotes inside strings", () => {
    expect(parseJsonObject('{"note":"use } and \\" carefully","n":2} trailing {')).toEqual({ note: 'use } and " carefully', n: 2 });
  });
  it("returns null for text with no object, a broken object, or an array", () => {
    expect(parseJsonObject("no json here")).toBeNull();
    expect(parseJsonObject('{"a": }')).toBeNull();
    expect(parseJsonObject("[1,2,3]")).toBeNull();
    expect(parseJsonObject('{"a":1')).toBeNull();
  });
});
