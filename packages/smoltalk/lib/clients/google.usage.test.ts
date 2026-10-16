import { describe, it, expect } from "vitest";
import { SmolGoogle } from "./google.js";
import { userMessage } from "../classes/message/index.js";

// gemini-2.5-flash: inputTokenCost=0.30, outputTokenCost=2.50.
// Gemini reports thinking in `thoughtsTokenCount`, separate from
// `candidatesTokenCount`, and bills it at the output rate.
const usageMetadata = {
  promptTokenCount: 1_000,
  candidatesTokenCount: 200,
  thoughtsTokenCount: 800,
  totalTokenCount: 2_000,
};

function makeClient() {
  return new SmolGoogle({
    model: "gemini-2.5-flash",
    apiKey: { google: "test" },
    messages: [],
  } as any);
}

function streamOf(chunks: any[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
}

describe("Google usage: thinking tokens", () => {
  it("_textSync counts thoughtsTokenCount as output tokens", async () => {
    const client = makeClient();
    (client as any).client = {
      models: {
        generateContent: async () => ({
          candidates: [{ finishReason: "STOP", content: { parts: [{ text: "hi" }] } }],
          usageMetadata,
        }),
      },
    };
    const res = await client._textSync({
      model: "gemini-2.5-flash",
      messages: [userMessage("hi")],
    } as any);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.value.usage!.outputTokens).toBe(1_000);
      // 1_000 output @ $2.50/M = $0.0025
      expect(res.value.cost!.outputCost).toBeCloseTo(0.0025, 6);
    }
  });

  it("_textStream counts thoughtsTokenCount as output tokens", async () => {
    const client = makeClient();
    (client as any).client = {
      models: {
        generateContentStream: async () =>
          streamOf([
            {
              candidates: [{ finishReason: "STOP", content: { parts: [{ text: "hi" }] } }],
              usageMetadata,
            },
          ]),
      },
    };
    let done: any;
    for await (const chunk of (client as any)._textStream({
      model: "gemini-2.5-flash",
      messages: [userMessage("hi")],
    })) {
      if (chunk.type === "done") done = chunk.result;
    }
    expect(done.usage.outputTokens).toBe(1_000);
    expect(done.cost.outputCost).toBeCloseTo(0.0025, 6);
  });

  it("leaves output tokens alone when the model did not think", async () => {
    const client = makeClient();
    (client as any).client = {
      models: {
        generateContent: async () => ({
          candidates: [{ finishReason: "STOP", content: { parts: [{ text: "hi" }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
        }),
      },
    };
    const res = await client._textSync({
      model: "gemini-2.5-flash",
      messages: [userMessage("hi")],
    } as any);
    if (res.success) {
      expect(res.value.usage!.outputTokens).toBe(5);
    }
  });
});
