import { describe, it, expect } from "vitest";
import { z } from "zod";
import { SmolGoogle } from "./google.js";
import { ToolCall } from "../classes/ToolCall.js";
import { AssistantMessage } from "../classes/message/index.js";

function makeClient() {
  return new SmolGoogle({
    model: "gemini-3-pro-preview",
    apiKey: { google: "test-key" },
    messages: [],
  } as any);
}

describe("Google: includeServerSideToolInvocations (error 1)", () => {
  it("sets it when function tools + web_search are combined", () => {
    const client = makeClient();
    const req = (client as any).buildRequest({
      model: "gemini-3-pro-preview",
      messages: [],
      tools: [{ name: "foo", description: "d", schema: z.object({ x: z.string() }) }],
      hostedTools: ["web_search"],
    });
    expect(req.config.toolConfig?.includeServerSideToolInvocations).toBe(true);
  });

  it("does not set it when only function tools are present", () => {
    const client = makeClient();
    const req = (client as any).buildRequest({
      model: "gemini-3-pro-preview",
      messages: [],
      tools: [{ name: "foo", description: "d", schema: z.object({ x: z.string() }) }],
    });
    expect(req.config.toolConfig?.includeServerSideToolInvocations).toBeUndefined();
  });

  it("does not set it when only web_search is present", () => {
    const client = makeClient();
    const req = (client as any).buildRequest({
      model: "gemini-3-pro-preview",
      messages: [],
      hostedTools: ["web_search"],
    });
    expect(req.config.toolConfig?.includeServerSideToolInvocations).toBeUndefined();
  });
});

describe("Google: thought_signature round-trip on functionCall parts (error 2)", () => {
  it("captures thoughtSignature riding on a functionCall part", async () => {
    const client = makeClient();
    (client as any).client = {
      models: {
        generateContent: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: { name: "researchAgent", args: { q: "hi" } },
                    thoughtSignature: "SIG123",
                  },
                ],
              },
            },
          ],
          usageMetadata: {},
        }),
      },
    };
    const res = await (client as any).__textSync({
      model: "gemini-3-pro-preview",
      contents: [],
      config: {},
    });
    expect(res.success).toBe(true);
    expect(res.value.toolCalls).toHaveLength(1);
    expect(res.value.toolCalls[0].thoughtSignature).toBe("SIG123");
  });

  it("ToolCall.toGoogle() re-emits the thoughtSignature on the part", () => {
    const tc = new ToolCall("", "foo", { x: 1 }, { thoughtSignature: "SIG" });
    expect(tc.toGoogle()).toEqual({
      functionCall: { name: "foo", args: { x: 1 } },
      thoughtSignature: "SIG",
    });
  });

  it("ToolCall.toGoogle() omits thoughtSignature when absent", () => {
    const tc = new ToolCall("", "foo", { x: 1 });
    expect(tc.toGoogle()).toEqual({ functionCall: { name: "foo", args: { x: 1 } } });
  });

  it("ToolCall round-trips thoughtSignature through JSON", () => {
    const tc = new ToolCall("", "foo", { x: 1 }, { thoughtSignature: "SIG" });
    const back = ToolCall.fromJSON(tc.toJSON());
    expect(back.thoughtSignature).toBe("SIG");
  });

  it("AssistantMessage.toGoogleMessage puts the signature on the functionCall part", () => {
    const msg = new AssistantMessage(null, {
      toolCalls: [new ToolCall("", "foo", { x: 1 }, { thoughtSignature: "SIG" })],
    });
    const g = msg.toGoogleMessage();
    const fcPart: any = (g.parts || []).find((p: any) => p.functionCall);
    expect(fcPart.thoughtSignature).toBe("SIG");
  });
});

// Wraps a fixed list of chunks as the async-iterable that
// generateContentStream resolves to.
function streamOf(chunks: any[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
}

async function collect(gen: AsyncGenerator<any>): Promise<any[]> {
  const out: any[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

describe("Google: thought_signature on the streaming path (error 2)", () => {
  it("captures thoughtSignature on a functionCall part without misfiling it as thinking", async () => {
    const client = makeClient();
    (client as any).client = {
      models: {
        generateContentStream: async () =>
          streamOf([
            {
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        functionCall: { name: "researchAgent", args: { q: "hi" } },
                        thoughtSignature: "SIG123",
                      },
                    ],
                  },
                },
              ],
            },
          ]),
      },
    };
    const chunks = await collect(
      (client as any)._textStream({ model: "gemini-3-pro-preview", messages: [] }),
    );
    // The part carries both functionCall and thoughtSignature; it must surface
    // as a tool call (with the signature), not a thinking block.
    expect(chunks.some((c) => c.type === "thinking")).toBe(false);
    const toolCallChunk = chunks.find((c) => c.type === "tool_call");
    expect(toolCallChunk).toBeDefined();
    expect(toolCallChunk.toolCall.name).toBe("researchAgent");
    expect(toolCallChunk.toolCall.thoughtSignature).toBe("SIG123");
    const done = chunks.find((c) => c.type === "done");
    expect(done.result.toolCalls[0].thoughtSignature).toBe("SIG123");
  });

  it("backfills a thoughtSignature that arrives in a later chunk than the functionCall", async () => {
    const client = makeClient();
    (client as any).client = {
      models: {
        generateContentStream: async () =>
          streamOf([
            {
              candidates: [
                { content: { parts: [{ functionCall: { name: "foo", args: { x: 1 } } }] } },
              ],
            },
            {
              candidates: [
                {
                  content: {
                    parts: [{ functionCall: { name: "foo" }, thoughtSignature: "LATE" }],
                  },
                },
              ],
            },
          ]),
      },
    };
    const chunks = await collect(
      (client as any)._textStream({ model: "gemini-3-pro-preview", messages: [] }),
    );
    const toolCalls = chunks.filter((c) => c.type === "tool_call");
    // Deduped to a single call whose signature was backfilled from chunk 2.
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].toolCall.name).toBe("foo");
    expect(toolCalls[0].toolCall.arguments).toEqual({ x: 1 });
    expect(toolCalls[0].toolCall.thoughtSignature).toBe("LATE");
  });
});
