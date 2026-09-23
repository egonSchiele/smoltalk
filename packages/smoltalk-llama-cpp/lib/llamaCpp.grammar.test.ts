import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Which grammar a typed call gets. A model whose chat wrapper has a thought
 * segment gets the grammar from thinkingGrammar.ts, built from the wrapper's
 * own tokens; any other model gets the plain schema grammar. And an empty
 * tool list must not count as tools, since node-llama-cpp cannot apply a
 * grammar and functions together and the grammar would be dropped.
 *
 * node-llama-cpp can't load a real GGUF in CI, so it is mocked; the mock
 * records the grammar text our code asks for and the options it generates
 * with.
 */

const h = vi.hoisted(() => {
  const record = {
    grammarTexts: [] as string[],
    generateOptions: [] as any[],
  };
  const wrapper = {
    // What resolveChatWrapper's settings.segments holds for the test's model.
    segments: undefined as any,
  };
  const reset = () => {
    record.grammarTexts = [];
    record.generateOptions = [];
    wrapper.segments = undefined;
  };
  return { record, wrapper, reset };
});

vi.mock("node-llama-cpp", () => {
  class LlamaChat {
    constructor(_opts: any) {}
    async generateResponse(_history: any[], options: any) {
      h.record.generateOptions.push(options);
      return { response: "{}", functionCalls: undefined };
    }
    dispose() {}
  }

  const makeSequence = () => ({
    tokenMeter: {
      getState: () => ({ usedInputTokens: 1, usedOutputTokens: 1 }),
    },
    async clearHistory() {},
  });

  const makeModel = () => ({
    tokenizer: () => [],
    async createContext() {
      const seq = makeSequence();
      return {
        totalSequences: 1,
        getSequence: () => seq,
        async dispose() {},
      };
    },
    async dispose() {},
  });

  const makeLlama = () => ({
    async loadModel() {
      return makeModel();
    },
    async createGrammarForJsonSchema() {
      return { grammar: 'root ::= "{" "}"', kind: "schema" };
    },
    async createGrammar({ grammar }: { grammar: string }) {
      h.record.grammarTexts.push(grammar);
      return { grammar, kind: "custom" };
    },
  });

  // The token ids the fake tokenizer gives the wrapper's markers.
  const TOKENS: Record<string, number[]> = {
    "<think>\n": [1000, 5],
    "\n</think>": [5, 1001],
  };
  class FakeLlamaText {
    constructor(public text: string) {}
    tokenize() {
      return TOKENS[this.text] ?? [];
    }
  }
  const LlamaText = (value: any) =>
    value instanceof FakeLlamaText ? value : new FakeLlamaText(value);
  const isLlamaText = (value: any) => value instanceof FakeLlamaText;

  return {
    getLlama: async () => makeLlama(),
    LlamaChat,
    LlamaLogLevel: { error: "error" },
    LlamaText,
    isLlamaText,
    resolveChatWrapper: () => ({ settings: { segments: h.wrapper.segments } }),
  };
});

import { LlamaCPP } from "./llamaCpp.js";
import { disposeAll } from "./nativeRegistry.js";

const responseFormat = { toJSONSchema: () => ({ type: "object" }) } as any;

function call(extra: Record<string, any> = {}) {
  const client = new LlamaCPP({
    model: "m.gguf",
    messages: [],
    metadata: { llamaCppModelDir: "/models" },
  });
  return client._textSync({
    model: "m.gguf",
    messages: [{ role: "user", content: "hi" }] as any,
    metadata: { llamaCppModelDir: "/models" },
    responseFormat,
    ...extra,
  } as any);
}

beforeEach(() => h.reset());
afterEach(async () => {
  await disposeAll();
});

describe("the grammar for a typed reply", () => {
  it("lets a thinking model close its block before the JSON", async () => {
    h.wrapper.segments = {
      thought: {
        prefix: "<think>\n",
        suffix: "\n</think>",
        openOnResponseStart: true,
      },
    };
    await call();
    expect(h.record.grammarTexts).toEqual([
      [
        "root ::= thinking-body <[1001]> thinking-gap thinking-json",
        "thinking-body ::= !<[1001]>*",
        "thinking-gap ::= [ \\t\\n]{0,4}",
        'thinking-json ::= "{" "}"',
      ].join("\n"),
    ]);
    expect(h.record.generateOptions[0].grammar.kind).toBe("custom");
  });

  it("makes the block optional when the model opens it itself", async () => {
    h.wrapper.segments = {
      thought: { prefix: "<think>\n", suffix: "\n</think>" },
    };
    await call();
    expect(h.record.grammarTexts[0].split("\n")[0]).toBe(
      "root ::= (<[1000]> thinking-body <[1001]>)? thinking-gap thinking-json",
    );
  });

  it("gives a model with no thought segment the plain schema grammar", async () => {
    await call();
    expect(h.record.grammarTexts).toEqual([]);
    expect(h.record.generateOptions[0].grammar.kind).toBe("schema");
  });

  it("keeps the grammar when the tool list is empty", async () => {
    await call({ tools: [] });
    expect(h.record.generateOptions[0].grammar.kind).toBe("schema");
    expect(h.record.generateOptions[0].functions).toBeUndefined();
  });

  it("drops the grammar for the tools when there are any", async () => {
    const tool = {
      name: "t",
      description: "a tool",
      schema: { toJSONSchema: () => ({ type: "object" }) },
    };
    await call({ tools: [tool] });
    expect(h.record.generateOptions[0].grammar).toBeUndefined();
    expect(Object.keys(h.record.generateOptions[0].functions)).toEqual(["t"]);
  });
});
