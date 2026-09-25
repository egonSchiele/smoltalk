import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Two things a tool-calling model has to be shown right, found with Gemma 4.
 *
 * A chain of tool calls is one model turn. smoltalk's tool loop records
 * each round as its own assistant message, and shown its chain as separate
 * turns, Gemma 4 ended the next turn at once. The history handed to
 * node-llama-cpp merges them.
 *
 * And Gemma 4's wrapper in node-llama-cpp 3.21.1 spells the markers around
 * a tool result differently from the model's own template, so a Gemma 4
 * model always gets a resolved wrapper, with the markers replaced.
 *
 * node-llama-cpp is mocked; the mock records the history and the wrapper
 * each generation got, and lets the test choose the model's architecture.
 */

const h = vi.hoisted(() => ({
  architecture: "qwen35",
  // The wrapper a named override resolves to: "qwen" for the Qwen class.
  overrideResolvesTo: undefined as string | undefined,
  histories: [] as any[],
  chatWrappers: [] as any[],
  resolved: [] as any[],
  resolveOptions: [] as any[],
  reset() {
    h.architecture = "qwen35";
    h.overrideResolvesTo = undefined;
    h.histories = [];
    h.chatWrappers = [];
    h.resolved = [];
    h.resolveOptions = [];
  },
}));

vi.mock("node-llama-cpp", () => {
  class LlamaChat {
    constructor(opts: any) {
      h.chatWrappers.push(opts.chatWrapper);
    }
    async generateResponse(history: any[], _options: any) {
      h.histories.push(history);
      return { response: "answer", fullResponse: ["answer"], functionCalls: undefined };
    }
    dispose() {}
  }
  class ChatWrapper {
    settings: any = {
      functions: { call: { prefix: "old" }, result: { prefix: "old" } },
      segments: {},
    };
  }
  class QwenChatWrapper extends ChatWrapper {}
  class DeepSeekChatWrapper extends ChatWrapper {}
  class SeedChatWrapper extends ChatWrapper {}
  class Gemma4ChatWrapper extends ChatWrapper {}
  class SpecialTokensText {
    constructor(public text: string) {}
  }
  const LlamaText = (...parts: any[]) => ({
    parts,
    toString: () => parts.map((p) => (typeof p === "string" ? p : p.text)).join(""),
  });
  const makeSequence = () => ({
    tokenMeter: { getState: () => ({ usedInputTokens: 1, usedOutputTokens: 1 }) },
    async clearHistory() {},
  });
  const makeModel = () => ({
    fileInfo: { metadata: { general: { architecture: h.architecture } } },
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
    }),
    LlamaChat,
    LlamaLogLevel: { error: "error" },
    LlamaText,
    SpecialTokensText,
    QwenChatWrapper,
    DeepSeekChatWrapper,
    SeedChatWrapper,
    Gemma4ChatWrapper,
    resolveChatWrapper: (_model: any, options: any) => {
      h.resolveOptions.push(options);
      const gemma = h.architecture === "gemma4" && options?.type === undefined;
      const wrapper = gemma ? new Gemma4ChatWrapper() : new QwenChatWrapper();
      h.resolved.push(wrapper);
      return wrapper;
    },
    resolvableChatWrapperTypeNames: ["auto", "qwen", "gemma4"],
  };
});

import { LlamaCPP } from "./llamaCpp.js";
import { disposeAll } from "./nativeRegistry.js";

function call(messages: any[]) {
  const client = new LlamaCPP({
    model: "m.gguf",
    messages,
    metadata: { llamaCppModelDir: "/models" },
  });
  return client._textSync({ model: "m.gguf", messages } as any);
}

beforeEach(() => h.reset());
afterEach(async () => {
  await disposeAll();
});

describe("a chain of tool calls in the history", () => {
  it("is one model turn, with each result on its call", async () => {
    await call([
      { role: "user", content: "How warm is it?" },
      { role: "assistant", content: "", toolCalls: [{ id: "a", name: "temp", arguments: { city: "Oslo" } }] },
      { role: "tool", tool_call_id: "a", content: "23" },
      { role: "assistant", content: "", toolCalls: [{ id: "b", name: "temp", arguments: { city: "Rome" } }] },
      { role: "tool", tool_call_id: "b", content: "30" },
      { role: "assistant", content: "Rome is warmer." },
      { role: "user", content: "Thanks. And Cairo?" },
      { role: "assistant", content: "", toolCalls: [{ id: "c", name: "temp", arguments: { city: "Cairo" } }] },
      { role: "tool", tool_call_id: "c", content: "35" },
    ]);
    expect(h.histories[0]).toEqual([
      { type: "user", text: "How warm is it?" },
      {
        type: "model",
        response: [
          { type: "functionCall", name: "temp", params: { city: "Oslo" }, result: "23" },
          { type: "functionCall", name: "temp", params: { city: "Rome" }, result: "30" },
          "Rome is warmer.",
        ],
      },
      { type: "user", text: "Thanks. And Cairo?" },
      {
        type: "model",
        response: [{ type: "functionCall", name: "temp", params: { city: "Cairo" }, result: "35" }],
      },
    ]);
  });

  it("keeps two plain assistant messages in a row apart", async () => {
    // A caller-built history, or a prefilled reply. Nothing was called, so
    // nothing is continued.
    await call([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "A" },
      { role: "assistant", content: "B" },
    ]);
    expect(h.histories[0].filter((item: any) => item.type === "model")).toEqual([
      { type: "model", response: ["A"] },
      { type: "model", response: ["B"] },
    ]);
  });

  it("keeps two assistant replies apart when a user message sits between them", async () => {
    await call([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
      { role: "user", content: "Again" },
      { role: "assistant", content: "Hello again" },
      { role: "user", content: "Bye" },
    ]);
    expect(h.histories[0].filter((item: any) => item.type === "model")).toEqual([
      { type: "model", response: ["Hello"] },
      { type: "model", response: ["Hello again"] },
    ]);
  });
});

describe("the Gemma 4 wrapper", () => {
  it("is resolved for a Gemma 4 model even when the call says nothing about thinking, with the model's own tool markers", async () => {
    h.architecture = "gemma4";
    await call([{ role: "user", content: "hi" }]);
    expect(h.resolved.length).toBe(1);
    expect(h.chatWrappers[0]).toBe(h.resolved[0]);
    const functions = h.chatWrappers[0].settings.functions;
    expect(functions.call.prefix.toString()).toBe("<|tool_call>call:");
    expect(functions.call.paramsPrefix).toBe("");
    expect(functions.call.suffix.toString()).toBe("<tool_call|>");
    expect(functions.result.prefix.toString()).toBe("<|tool_response>response:{{functionName}}{value:");
    expect(functions.result.suffix.toString()).toBe("}<tool_response|>");
    // The rest of the settings are the wrapper's own.
    expect(h.chatWrappers[0].settings.segments).toEqual({});
  });

  it("keeps a wrapper the call named as it is, but still tells it about thinking", async () => {
    h.architecture = "gemma4";
    h.overrideResolvesTo = "qwen";
    const client = new LlamaCPP({
      model: "m.gguf",
      messages: [],
      metadata: { llamaCppModelDir: "/models", llamaCppChatWrapper: "qwen" },
    });
    await client._textSync({
      model: "m.gguf",
      messages: [{ role: "user", content: "hi" }],
      thinking: { enabled: false },
    } as any);
    // The named wrapper is not the family's, so it keeps its own markers,
    // and it gets the settings for every wrapper, not Gemma 4's alone.
    expect(h.chatWrappers[0].settings.functions.call.prefix).toBe("old");
    expect(h.resolveOptions[0].customWrapperSettings).toEqual({
      qwen: { thoughts: "discourage" },
      gemma4: { reasoning: false },
      seed: { thinkingBudget: 0 },
      harmony: { reasoningEffort: "low" },
    });
  });

  it("is left to node-llama-cpp for another model", async () => {
    await call([{ role: "user", content: "hi" }]);
    expect(h.chatWrappers[0]).toBe("auto");
    expect(h.resolved).toEqual([]);
  });
});
