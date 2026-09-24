import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * A call's `thinking` and `reasoningEffort` reach node-llama-cpp two ways.
 * The chat wrapper is told, through its own settings, whether to open a
 * thought block at all. The generation gets a `budgets.thoughtTokens` cap.
 * A call that says nothing leaves both alone, so the model's usual wrapper
 * and node-llama-cpp's own default budget apply.
 */

const h = vi.hoisted(() => ({
  chatOptions: [] as any[],
  generateOptions: [] as any[],
  resolveOptions: [] as any[],
  reset() {
    h.chatOptions = [];
    h.generateOptions = [];
    h.resolveOptions = [];
  },
}));

vi.mock("node-llama-cpp", () => {
  class LlamaChat {
    constructor(opts: any) {
      h.chatOptions.push(opts);
    }
    async generateResponse(_history: any[], options: any) {
      h.generateOptions.push(options);
      options?.onTextChunk?.("answer");
      return { response: "answer", fullResponse: ["answer"], functionCalls: undefined };
    }
    dispose() {}
  }
  class ChatWrapper {
    get settings() {
      return { segments: {} };
    }
  }
  class QwenChatWrapper extends ChatWrapper {}
  class DeepSeekChatWrapper extends ChatWrapper {}
  class SeedChatWrapper extends ChatWrapper {}
  class Gemma4ChatWrapper extends ChatWrapper {}
  const makeSequence = () => ({
    tokenMeter: { getState: () => ({ usedInputTokens: 1, usedOutputTokens: 1 }) },
    async clearHistory() {},
  });
  const makeModel = () => ({
    async createContext() {
      const seq = makeSequence();
      return { totalSequences: 1, getSequence: () => seq, async dispose() {} };
    },
    async dispose() {},
  });
  return {
    getLlama: async () => ({
      async loadModel() {
        return makeModel();
      },
      async createGrammarForJsonSchema() {
        return { grammar: 'root ::= "{" "}"' };
      },
    }),
    LlamaChat,
    LlamaLogLevel: { error: "error" },
    QwenChatWrapper,
    DeepSeekChatWrapper,
    SeedChatWrapper,
    Gemma4ChatWrapper,
    resolveChatWrapper: (_model: any, options: any) => {
      h.resolveOptions.push(options);
      return new QwenChatWrapper();
    },
  };
});

import { LlamaCPP } from "./llamaCpp.js";
import { disposeAll } from "./nativeRegistry.js";

const messages = [{ role: "user", content: "hi" }] as any;

function call(extra: Record<string, any>) {
  const client = new LlamaCPP({
    model: "m.gguf",
    messages,
    metadata: { llamaCppModelDir: "/models" },
    ...extra,
  });
  return client.text({ model: "m.gguf", messages, ...extra } as any);
}

async function drain(gen: AsyncGenerator<any>) {
  for await (const _ of gen) {
    // consumed for its side effects on the recorder
  }
}

beforeEach(() => h.reset());
afterEach(async () => {
  await disposeAll();
});

describe("thinking controls", () => {
  it("leaves the wrapper and the budget alone when the call says nothing", async () => {
    await call({});
    expect(h.resolveOptions).toEqual([]);
    expect(h.chatOptions[0].chatWrapper).toBe("auto");
    expect(h.generateOptions[0].budgets).toBeUndefined();
  });

  it("turns thinking off through the wrapper's own switch and a zero budget", async () => {
    await call({ thinking: { enabled: false } });
    expect(h.resolveOptions[0].customWrapperSettings).toEqual({
      qwen: { thoughts: "discourage" },
      gemma4: { reasoning: false },
      seed: { thinkingBudget: 0 },
      harmony: { reasoningEffort: "low" },
    });
    expect(h.chatOptions[0].chatWrapper).not.toBe("auto");
    expect(h.generateOptions[0].budgets).toEqual({ thoughtTokens: 0 });
  });

  it("passes a thinking budget through as the thought-token budget", async () => {
    await call({ thinking: { enabled: true, budgetTokens: 512 } });
    expect(h.chatOptions[0].chatWrapper).toBe("auto");
    expect(h.generateOptions[0].budgets).toEqual({ thoughtTokens: 512 });
  });

  it("maps a reasoning effort to a budget, and tells Harmony the effort itself", async () => {
    await call({ reasoningEffort: "low" });
    expect(h.generateOptions[0].budgets).toEqual({ thoughtTokens: 2048 });
    expect(h.resolveOptions[0].customWrapperSettings).toEqual({
      harmony: { reasoningEffort: "low" },
    });
    h.reset();
    await call({ reasoningEffort: "high" });
    expect(h.generateOptions[0].budgets).toEqual({ thoughtTokens: 16384 });
  });

  it("lets an explicit budget win over an effort", async () => {
    await call({ reasoningEffort: "high", thinking: { enabled: true, budgetTokens: 100 } });
    expect(h.generateOptions[0].budgets).toEqual({ thoughtTokens: 100 });
  });

  it("does the same on the streaming path", async () => {
    const client = new LlamaCPP({
      model: "m.gguf",
      messages,
      metadata: { llamaCppModelDir: "/models" },
    });
    await drain(
      client.textStream({
        model: "m.gguf",
        messages,
        thinking: { enabled: false },
      } as any),
    );
    expect(h.chatOptions[0].chatWrapper).not.toBe("auto");
    expect(h.generateOptions[0].budgets).toEqual({ thoughtTokens: 0 });
  });
});
