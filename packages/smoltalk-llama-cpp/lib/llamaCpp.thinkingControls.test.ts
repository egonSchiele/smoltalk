import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * A call's `thinking` and `reasoningEffort` reach node-llama-cpp two ways.
 * The chat wrapper is told, through its own settings, whether to open a
 * thought block at all. The generation gets a `budgets.thoughtTokens` cap.
 * A call that says nothing leaves the wrapper alone and passes an empty
 * `budgets`, which is what makes LlamaChat apply its own default budget.
 * The chat and the typed-reply grammar share one resolved wrapper, and a
 * resolved wrapper is kept per model so the slow resolution runs once.
 */

const h = vi.hoisted(() => ({
  chatOptions: [] as any[],
  generateOptions: [] as any[],
  resolveOptions: [] as any[],
  resolved: [] as any[],
  grammarWrappers: [] as any[],
  warnings: [] as string[],
  reset() {
    h.chatOptions = [];
    h.generateOptions = [];
    h.resolveOptions = [];
    h.resolved = [];
    h.grammarWrappers = [];
    h.warnings = [];
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
      async createGrammar({ grammar }: { grammar: string }) {
        return { grammar };
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
      const wrapper = new QwenChatWrapper();
      h.resolved.push(wrapper);
      return wrapper;
    },
    resolvableChatWrapperTypeNames: ["auto", "qwen", "gemma4", "harmony", "chatML", "template"],
  };
});

vi.mock("smoltalk", async (importOriginal) => {
  const original = await importOriginal<typeof import("smoltalk")>();
  return {
    ...original,
    getLogger: () => ({
      warn: (...args: any[]) => h.warnings.push(args.join(" ")),
      debug() {},
      info() {},
      error() {},
    }),
  };
});

import { LlamaCPP } from "./llamaCpp.js";
import { disposeAll } from "./nativeRegistry.js";

const messages = [{ role: "user", content: "hi" }] as any;
const responseFormat = { toJSONSchema: () => ({ type: "object" }) } as any;

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
  it("leaves the wrapper alone and lets LlamaChat apply its default budget when the call says nothing", async () => {
    await call({});
    expect(h.resolveOptions).toEqual([]);
    expect(h.chatOptions[0].chatWrapper).toBe("auto");
    expect(h.generateOptions[0].budgets).toEqual({});
  });

  it("turns thinking off through the wrapper's own switch and a zero budget", async () => {
    await call({ thinking: { enabled: false } });
    expect(h.resolveOptions[0].customWrapperSettings).toEqual({
      qwen: { thoughts: "discourage" },
      gemma4: { reasoning: false },
      seed: { thinkingBudget: 0 },
      harmony: { reasoningEffort: "low" },
    });
    expect(h.chatOptions[0].chatWrapper).toBe(h.resolved[0]);
    expect(h.generateOptions[0].budgets).toEqual({ thoughtTokens: 0 });
  });

  it("asks for thinking when the call turns it on", async () => {
    await call({ thinking: { enabled: true, budgetTokens: 512 } });
    expect(h.resolveOptions[0].customWrapperSettings).toEqual({
      qwen: { thoughts: "auto" },
      gemma4: { reasoning: true },
      seed: { thinkingBudget: 512 },
    });
    expect(h.generateOptions[0].budgets).toEqual({ thoughtTokens: 512 });
  });

  it("maps a reasoning effort to a budget, and tells Harmony the effort itself", async () => {
    await call({ reasoningEffort: "low" });
    expect(h.generateOptions[0].budgets).toEqual({ thoughtTokens: 2048 });
    expect(h.resolveOptions[0].customWrapperSettings).toEqual({
      harmony: { reasoningEffort: "low" },
    });
  });

  it("raises the cap over a big budget when the call set none, and holds the budget under a cap the call set", async () => {
    await call({ reasoningEffort: "high" });
    expect(h.generateOptions[0].budgets).toEqual({ thoughtTokens: 16384 });
    expect(h.generateOptions[0].maxTokens).toBe(16384 + 4096);
    expect(h.warnings).toEqual([]);
    h.reset();
    // An eighth of the cap is kept for the answer: 3000 of 4000 fits.
    await call({ thinking: { enabled: true, budgetTokens: 3000 }, maxTokens: 4000 });
    expect(h.generateOptions[0].maxTokens).toBe(4000);
    expect(h.generateOptions[0].budgets).toEqual({ thoughtTokens: 3000 });
    expect(h.warnings).toEqual([]);
    h.reset();
    await call({ thinking: { enabled: true, budgetTokens: 3900 }, maxTokens: 4000 });
    expect(h.generateOptions[0].budgets).toEqual({ thoughtTokens: 3500 });
    expect(h.warnings[0]).toContain("leaves no room for the answer");
  });

  it("lets a raw maxTokens set the cap the budget is held under", async () => {
    await call({
      thinking: { enabled: true, budgetTokens: 3900 },
      rawAttributes: { maxTokens: 4000 },
    });
    expect(h.generateOptions[0].maxTokens).toBe(4000);
    expect(h.generateOptions[0].budgets).toEqual({ thoughtTokens: 3500 });
  });

  it("lets an explicit budget win over an effort", async () => {
    await call({ reasoningEffort: "high", thinking: { enabled: true, budgetTokens: 100 } });
    expect(h.generateOptions[0].budgets).toEqual({ thoughtTokens: 100 });
  });

  it("gives the chat and the grammar one wrapper, resolved once per setting", async () => {
    await call({ thinking: { enabled: false }, responseFormat });
    await call({ thinking: { enabled: false }, responseFormat });
    // One resolution for two calls with the same setting, and the chat got
    // that very instance both times. The grammar test checks the grammar's
    // side of the sharing.
    expect(h.resolved.length).toBe(1);
    expect(h.chatOptions[0].chatWrapper).toBe(h.resolved[0]);
    expect(h.chatOptions[1].chatWrapper).toBe(h.resolved[0]);
  });

  it("resolves the wrapper a call names, with the thinking settings on top", async () => {
    await call({ metadata: { llamaCppModelDir: "/models", llamaCppChatWrapper: "chatML" } });
    expect(h.resolveOptions).toEqual([{ type: "chatML" }]);
    expect(h.chatOptions[0].chatWrapper).toBe(h.resolved[0]);
    h.reset();
    await call({
      metadata: { llamaCppModelDir: "/models", llamaCppChatWrapper: "qwen" },
      thinking: { enabled: false },
    });
    expect(h.resolveOptions[0].type).toBe("qwen");
    expect(h.resolveOptions[0].customWrapperSettings.qwen).toEqual({ thoughts: "discourage" });
  });

  it("refuses a wrapper name node-llama-cpp does not know, and the two it knows but cannot use", () => {
    for (const name of ["llama9", "template", "auto"]) {
      expect(
        () =>
          new LlamaCPP({
            model: "m.gguf",
            messages,
            metadata: { llamaCppModelDir: "/models", llamaCppChatWrapper: name },
          }),
        name,
      ).toThrow("llamaCppChatWrapper must be one of qwen, gemma4, harmony, chatML;");
    }
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
    expect(h.chatOptions[0].chatWrapper).toBe(h.resolved[0]);
    expect(h.generateOptions[0].budgets).toEqual({ thoughtTokens: 0 });
  });
});
