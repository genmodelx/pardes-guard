import { describe, expect, it } from "vitest";
import type { ChatTurn } from "@/lib/ai";
import { SKIP_SIGNATURE, modelTurnFrom, toContents } from "@/lib/ai-chat-wire";

const MODEL = "gemini-3.8-flash";

describe("thought signatures in the assistant's conversation", () => {
  it("keeps the signature Gemini put on a function call, and drops thought parts", () => {
    const turn = modelTurnFrom(
      [
        { thought: true, text: "planning" },
        { functionCall: { name: "check_recruiter", args: { name: "Northstar" }, id: "c1" }, thoughtSignature: "sig-1" },
        { functionCall: { name: "route_info", args: { country: "SA" } } },
      ],
      MODEL,
    );
    expect(turn).toEqual({
      role: "model",
      model: MODEL,
      parts: [
        { functionCall: { name: "check_recruiter", args: { name: "Northstar" }, id: "c1" }, thoughtSignature: "sig-1" },
        { functionCall: { name: "route_info", args: { country: "SA" } } },
      ],
    });
  });

  it("keeps a text answer with its signature, and gives an empty turn for no parts", () => {
    expect(modelTurnFrom([{ text: "Yes, it is on the list.", thoughtSignature: "sig-t" }], MODEL).parts).toEqual([{ text: "Yes, it is on the list.", thoughtSignature: "sig-t" }]);
    expect(modelTurnFrom(undefined, MODEL).parts).toEqual([]);
  });

  it("sends the signature back unchanged to the model that made it, with the result as a user turn", () => {
    const call = modelTurnFrom([{ functionCall: { name: "check_recruiter", args: { name: "Northstar" }, id: "c1" }, thoughtSignature: "sig-1" }], MODEL);
    const history: ChatTurn[] = [
      { role: "user", parts: [{ text: "Is Northstar licensed?" }] },
      call,
      { role: "user", parts: [{ functionResponse: { name: "check_recruiter", id: "c1", response: { found: false } } }] },
    ];
    expect(toContents(history, MODEL)).toEqual([
      { role: "user", parts: [{ type: "text", text: "Is Northstar licensed?" }] },
      { role: "model", parts: [{ type: "functionCall", functionCall: { name: "check_recruiter", args: { name: "Northstar" }, id: "c1" }, thoughtSignature: "sig-1" }] },
      { role: "user", parts: [{ type: "functionResponse", functionResponse: { name: "check_recruiter", id: "c1", response: { found: false } } }] },
    ]);
  });

  it("gives another model the placeholder on the first call only, never the first model's signature", () => {
    const turn = modelTurnFrom(
      [
        { functionCall: { name: "check_recruiter", args: {} }, thoughtSignature: "sig-1" },
        { functionCall: { name: "route_info", args: {} } },
      ],
      MODEL,
    );
    const [content] = toContents([turn], "gemini-3.5-flash-lite");
    expect(content.parts).toEqual([
      { type: "functionCall", functionCall: { name: "check_recruiter", args: {} }, thoughtSignature: SKIP_SIGNATURE },
      { type: "functionCall", functionCall: { name: "route_info", args: {} } },
    ]);
  });

  it("gives the placeholder to a call that came without a model or a signature", () => {
    const [content] = toContents([{ role: "model", parts: [{ functionCall: { name: "check_recruiter", args: {}, id: "c1" } }] }], MODEL);
    expect(content.parts[0]).toEqual({ type: "functionCall", functionCall: { name: "check_recruiter", args: {}, id: "c1" }, thoughtSignature: SKIP_SIGNATURE });
  });
});
