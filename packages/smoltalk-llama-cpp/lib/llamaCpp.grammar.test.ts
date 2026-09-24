import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Which grammar a typed call gets. A wrapper whose reply is one thought
 * block then the answer (Qwen, DeepSeek, Seed, Gemma 4) gets the grammar
 * from thinkingGrammar.ts, built from the wrapper's own tokens. Every other
 * wrapper gets the plain schema grammar: Harmony and Muse put the answer in
 * a second channel, and the template fallback for an unknown model can
 * spell its markers as plain text. And an empty tool list must not count
 * as tools, since node-llama-cpp cannot apply a grammar and functions
 * together and the grammar would be dropped.
 *
 * node-llama-cpp can't load a real GGUF in CI, so it is mocked; the mock
 * records the grammar text our code asks for and the options it generates
 * with.
 */

const h = vi.hoisted(() => {
  const record = {
    grammarTexts: [] as string[],
    generateOptions: [] as any[],
    chatWrappers: [] as any[],
    resolved: [] as any[],
  };
  const wrapper = {
    // Which fake wrapper class resolveChatWrapper returns, and its thought
    // segment settings.
    name: "General" as string,
    thought: undefined as any,
  };
  const reset = () => {
    record.grammarTexts = [];
    record.generateOptions = [];
    record.chatWrappers = [];
    record.resolved = [];
    wrapper.name = "General";
    wrapper.thought = undefined;
  };
  return { record, wrapper, reset };
});

vi.mock("node-llama-cpp", () => {
  class LlamaChat {
    constructor(opts: any) {
      h.record.chatWrappers.push(opts.chatWrapper);
    }
    async generateResponse(_history: any[], options: any) {
      h.record.generateOptions.push(options);
      return { response: "{}", functionCalls: undefined };
    }
    dispose() {}
  }

  // The token ids the fake tokenizer gives each marker. A tag marker is
  // one token; a plain-text marker splits into ordinary tokens.
  const TOKENS: Record<string, number[]> = {
    "<think>\n": [1000, 5],
    "\n</think>": [5, 1001],
    "</think>": [1001],
    "<think>": [1000],
    "<seed:think>": [2000],
    "</seed:think>": [2001],
  };
  const TEXT: Record<number, string> = {
    1000: "<think>",
    1001: "</think>",
    2000: "<seed:think>",
    2001: "</seed:think>",
    5: "\n",
  };
  class FakeLlamaText {
    constructor(public text: string) {}
    tokenize() {
      return TOKENS[this.text] ?? [60, 47, 62];
    }
    toString() {
      return this.text;
    }
  }
  const LlamaText = (value: any) =>
    value instanceof FakeLlamaText ? value : new FakeLlamaText(value);
  const isLlamaText = (value: any) => value instanceof FakeLlamaText;

  const makeSequence = () => ({
    tokenMeter: {
      getState: () => ({ usedInputTokens: 1, usedOutputTokens: 1 }),
    },
    async clearHistory() {},
  });

  const makeModel = () => ({
    tokenizer: () => [],
    detokenize: (tokens: number[]) =>
      tokens.map((t) => TEXT[t] ?? "x").join(""),
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

  class ChatWrapper {
    // Told not to think, Qwen's wrapper no longer opens the block itself.
    discouraged = false;
    get settings() {
      const thought =
        h.wrapper.thought === undefined
          ? undefined
          : { ...h.wrapper.thought, ...(this.discouraged ? { openOnResponseStart: false } : {}) };
      return { segments: { thought } };
    }
  }
  class QwenChatWrapper extends ChatWrapper {}
  class DeepSeekChatWrapper extends ChatWrapper {}
  class SeedChatWrapper extends ChatWrapper {}
  class Gemma4ChatWrapper extends ChatWrapper {}
  class HarmonyChatWrapper extends ChatWrapper {}
  class GeneralChatWrapper extends ChatWrapper {}
  const classes: Record<string, new () => ChatWrapper> = {
    Qwen: QwenChatWrapper,
    DeepSeek: DeepSeekChatWrapper,
    Seed: SeedChatWrapper,
    Gemma4: Gemma4ChatWrapper,
    Harmony: HarmonyChatWrapper,
    General: GeneralChatWrapper,
  };

  return {
    getLlama: async () => makeLlama(),
    LlamaChat,
    LlamaLogLevel: { error: "error" },
    LlamaText,
    isLlamaText,
    QwenChatWrapper,
    DeepSeekChatWrapper,
    SeedChatWrapper,
    Gemma4ChatWrapper,
    resolveChatWrapper: (_model: any, options?: any) => {
      const wrapper = new classes[h.wrapper.name]();
      if (options?.customWrapperSettings?.qwen?.thoughts === "discourage") {
        wrapper.discouraged = true;
      }
      h.record.resolved.push(wrapper);
      return wrapper;
    },
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

function grammarKind(): string {
  return h.record.generateOptions[0].grammar.kind;
}

function qwenThought(extra: Record<string, any> = {}) {
  return { prefix: "<think>\n", suffix: "\n</think>", ...extra };
}

beforeEach(() => h.reset());
afterEach(async () => {
  await disposeAll();
});

describe("the grammar for a typed reply", () => {
  it("lets a Qwen model close its auto-opened block before the JSON", async () => {
    h.wrapper.name = "Qwen";
    h.wrapper.thought = qwenThought({ openOnResponseStart: true });
    await call();
    expect(h.record.grammarTexts).toEqual([
      [
        "root ::= thinking-body <[1001]> thinking-gap thinking-json",
        "thinking-body ::= !<[1001]>*",
        "thinking-gap ::= [ \\t\\n]{0,4}",
        'thinking-json ::= "{" "}"',
      ].join("\n"),
    ]);
    expect(grammarKind()).toBe("custom");
  });

  it("makes the block optional when the model opens it itself", async () => {
    h.wrapper.name = "DeepSeek";
    h.wrapper.thought = { prefix: "<think>", suffix: "</think>" };
    await call();
    expect(h.record.grammarTexts[0].split("\n")[0]).toBe(
      "root ::= (<[1000]> thinking-body <[1001]>)? thinking-gap thinking-json",
    );
  });

  it("uses each wrapper's own markers", async () => {
    h.wrapper.name = "Seed";
    h.wrapper.thought = { prefix: "<seed:think>", suffix: "</seed:think>" };
    await call();
    expect(h.record.grammarTexts[0].split("\n")[0]).toBe(
      "root ::= (<[2000]> thinking-body <[2001]>)? thinking-gap thinking-json",
    );
  });

  it("gives the plain schema grammar to wrappers with another layout", async () => {
    for (const name of ["Harmony", "General"]) {
      h.reset();
      h.wrapper.name = name;
      h.wrapper.thought = qwenThought({ openOnResponseStart: true });
      await call();
      expect(h.record.grammarTexts, name).toEqual([]);
      expect(grammarKind(), name).toBe("schema");
      await disposeAll();
    }
  });

  it("gives the plain schema grammar when a marker is not one tag token", async () => {
    h.wrapper.name = "Qwen";
    h.wrapper.thought = { prefix: "<think>", suffix: "plain text marker" };
    await call();
    expect(h.record.grammarTexts).toEqual([]);
    expect(grammarKind()).toBe("schema");
  });

  it("gives a wrapper with no thought segment the plain schema grammar", async () => {
    h.wrapper.name = "Qwen";
    await call();
    expect(h.record.grammarTexts).toEqual([]);
    expect(grammarKind()).toBe("schema");
  });

  it("makes the block optional for a Qwen model told not to think, and builds it on the chat's own wrapper", async () => {
    h.wrapper.name = "Qwen";
    h.wrapper.thought = qwenThought({ openOnResponseStart: true });
    await call({ thinking: { enabled: false } });
    // The wrapper was resolved once, with the switch, and the chat got that
    // instance; the grammar read the same instance, so it saw the block as
    // optional rather than already open.
    expect(h.record.resolved.length).toBe(1);
    expect(h.record.chatWrappers[0]).toBe(h.record.resolved[0]);
    expect(h.record.grammarTexts[0].split("\n")[0]).toBe(
      "root ::= (<[1000]> thinking-body <[1001]>)? thinking-gap thinking-json",
    );
  });

  it("keeps the grammar when the tool list is empty", async () => {
    await call({ tools: [] });
    expect(grammarKind()).toBe("schema");
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
