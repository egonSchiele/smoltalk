import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Thinking models (Qwen3, DeepSeek-R1) emit hidden reasoning inside a thought
 * segment. node-llama-cpp separates it out: `result.response` is visible text
 * only, thought segments live in `result.fullResponse`, and streaming delivers
 * them via `onResponseChunk`. Dropping them hides real behavior — one incident
 * involved 169k invisible thinking tokens — so the provider maps them into
 * smoltalk's `PromptResult.thinkingBlocks` (sync + stream `done`) and live
 * `{type: "thinking"}` stream chunks. llama.cpp has no signed reasoning, so
 * `signature` is always `""` (the google client's convention when absent).
 */

const h = vi.hoisted(() => ({
  // When true, the mock generates with a leading thought segment.
  withThoughts: true,
}));

vi.mock("node-llama-cpp", () => {
  class LlamaChat {
    constructor(_opts: any) {}
    async generateResponse(_history: any[], options: any) {
      if (h.withThoughts) {
        options?.onResponseChunk?.({
          type: "segment",
          segmentType: "thought",
          text: "hmm, ",
        });
        options?.onResponseChunk?.({
          type: "segment",
          segmentType: "thought",
          text: "let me think",
        });
      }
      options?.onResponseChunk?.({
        type: undefined,
        segmentType: undefined,
        text: "answer",
      });
      options?.onTextChunk?.("answer");
      await new Promise((r) => setTimeout(r, 2));
      return {
        response: "answer",
        fullResponse: h.withThoughts
          ? [
              {
                type: "segment",
                segmentType: "thought",
                text: "hmm, let me think",
                ended: true,
                raw: [],
              },
              "answer",
            ]
          : ["answer"],
        functionCalls: undefined,
      };
    }
    dispose() {}
  }

  const makeSequence = () => ({
    tokenMeter: {
      getState: () => ({ usedInputTokens: 1, usedOutputTokens: 1 }),
    },
    async clearHistory() {},
  });

  const makeContext = () => {
    let seq: any = null;
    return {
      totalSequences: 1,
      getSequence() {
        if (!seq) seq = makeSequence();
        return seq;
      },
      async dispose() {},
    };
  };

  const makeModel = () => ({
    async createContext(_opts: any) {
      return makeContext();
    },
    async dispose() {},
  });

  return {
    getLlama: async () => ({
      async loadModel(_opts: any) {
        return makeModel();
      },
      async createGrammarForJsonSchema(_schema: any) {
        return {};
      },
    }),
    LlamaChat,
    LlamaLogLevel: { error: "error" },
  };
});

import { LlamaCPP } from "./llamaCpp.js";
import { disposeAll } from "./nativeRegistry.js";

function makeClient() {
  return new LlamaCPP({
    model: "m.gguf",
    messages: [],
    metadata: { llamaCppModelDir: "/models" },
  });
}

const messages = [{ role: "user", content: "hi" }] as any;

async function drainStream(gen: AsyncGenerator<any>) {
  const chunks: any[] = [];
  for await (const c of gen) chunks.push(c);
  return chunks;
}

beforeEach(() => {
  h.withThoughts = true;
});
afterEach(async () => {
  await disposeAll();
});

describe("thinking blocks", () => {
  it("sync: thought segments land in thinkingBlocks with an empty signature", async () => {
    const result = await makeClient()._textSync({ messages } as any);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.output).toBe("answer");
      expect(result.value.thinkingBlocks).toEqual([
        { text: "hmm, let me think", signature: "" },
      ]);
    }
  });

  it("sync: no thought segments means no thinkingBlocks key at all", async () => {
    h.withThoughts = false;
    const result = await makeClient()._textSync({ messages } as any);
    expect(result.success).toBe(true);
    if (result.success) {
      expect("thinkingBlocks" in result.value).toBe(false);
    }
  });

  it("stream: thought segments stream live as thinking chunks, before the text", async () => {
    const chunks = await drainStream(
      makeClient()._textStream({ messages } as any),
    );
    const types = chunks.map((c) => c.type);
    expect(types.indexOf("thinking")).toBeGreaterThanOrEqual(0);
    expect(types.indexOf("thinking")).toBeLessThan(types.indexOf("text"));
    const thought = chunks
      .filter((c) => c.type === "thinking")
      .map((c) => c.text)
      .join("");
    expect(thought).toBe("hmm, let me think");
  });

  it("stream: the done result carries thinkingBlocks", async () => {
    const chunks = await drainStream(
      makeClient()._textStream({ messages } as any),
    );
    const done = chunks.find((c) => c.type === "done");
    expect(done?.result.thinkingBlocks).toEqual([
      { text: "hmm, let me think", signature: "" },
    ]);
  });

  it("stream: main-response text is not duplicated by the segment callback", async () => {
    const chunks = await drainStream(
      makeClient()._textStream({ messages } as any),
    );
    const text = chunks
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
    expect(text).toBe("answer");
  });
});
