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
    schemas: [] as any[],
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
  // Whether the fake schema grammar carries node-llama-cpp's indentation
  // rules, for the test of their loosening.
  let grammarWithIndentation = false;
  const reset = () => {
    record.grammarTexts = [];
    record.schemas = [];
    record.generateOptions = [];
    record.chatWrappers = [];
    record.resolved = [];
    wrapper.name = "General";
    wrapper.thought = undefined;
    api.grammarWithIndentation = false;
  };
  const api = { record, wrapper, reset, grammarWithIndentation };
  return api;
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
    async createGrammarForJsonSchema(schema: any) {
      h.record.schemas.push(schema);
      if (h.grammarWithIndentation) {
        return {
          grammar: ['root ::= "[" whitespace-b-1-4-rule "]"', 'whitespace-b-1-4-rule ::= [\\n] ("    " | "\\t") | [ ]?'].join("\n"),
          kind: "schema",
        };
      }
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
      // Only Qwen's wrapper has the switch; the others keep their layout.
      if (
        wrapper instanceof QwenChatWrapper &&
        options?.customWrapperSettings?.qwen?.thoughts === "discourage"
      ) {
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

// The schema's own grammar, as the mock builds it. Every grammar the
// plugin generates with is rebuilt from text, so the plain schema shows
// up as this text and nothing else.
const SCHEMA_GBNF = 'root ::= "{" "}"';

function expectPlainSchemaGrammar(name?: string) {
  expect(h.record.grammarTexts, name).toEqual([SCHEMA_GBNF]);
  expect(h.record.generateOptions[0].grammar.grammar, name).toBe(SCHEMA_GBNF);
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
      SCHEMA_GBNF,
      [
        "root ::= thinking-body <[1001]> thinking-gap thinking-json",
        "thinking-body ::= !<[1001]>*",
        "thinking-gap ::= [ \\t\\n]{0,4}",
        'thinking-json ::= "{" "}"',
      ].join("\n"),
    ]);
  });

  it("makes the block optional when the model opens it itself", async () => {
    h.wrapper.name = "DeepSeek";
    h.wrapper.thought = { prefix: "<think>", suffix: "</think>" };
    await call();
    expect(h.record.grammarTexts[1].split("\n")[0]).toBe(
      "root ::= (<[1000]> thinking-body <[1001]>)? thinking-gap thinking-json",
    );
  });

  it("uses each wrapper's own markers", async () => {
    h.wrapper.name = "Seed";
    h.wrapper.thought = { prefix: "<seed:think>", suffix: "</seed:think>" };
    await call();
    expect(h.record.grammarTexts[1].split("\n")[0]).toBe(
      "root ::= (<[2000]> thinking-body <[2001]>)? thinking-gap thinking-json",
    );
  });

  it("gives the plain schema grammar to wrappers with another layout", async () => {
    for (const name of ["Harmony", "General"]) {
      h.reset();
      h.wrapper.name = name;
      h.wrapper.thought = qwenThought({ openOnResponseStart: true });
      await call();
      expectPlainSchemaGrammar(name);
      await disposeAll();
    }
  });

  it("gives the plain schema grammar when a marker is not one tag token", async () => {
    h.wrapper.name = "Qwen";
    h.wrapper.thought = { prefix: "<think>", suffix: "plain text marker" };
    await call();
    expectPlainSchemaGrammar();
  });

  it("gives a wrapper with no thought segment the plain schema grammar", async () => {
    h.wrapper.name = "Qwen";
    await call();
    expectPlainSchemaGrammar();
  });

  it("gives a Qwen model told not to think the schema alone, read off the chat's own wrapper", async () => {
    h.wrapper.name = "Qwen";
    h.wrapper.thought = qwenThought({ openOnResponseStart: true });
    await call({ thinking: { enabled: false } });
    // The wrapper was resolved once, with the switch, and the chat got that
    // instance; the grammar read the same instance, so it saw that the
    // block is no longer opened for the model. With thinking off the block
    // is not offered at all: offered as an option, the model took it and
    // wrote prose inside.
    expect(h.record.resolved.length).toBe(1);
    expect(h.record.chatWrappers[0]).toBe(h.record.resolved[0]);
    expectPlainSchemaGrammar();
  });

  it("still makes a model told not to think close a block its wrapper opens anyway", async () => {
    // DeepSeek's wrapper has no switch: the block opens on every reply and
    // a zero budget closes it, so the grammar has to let the close through.
    h.wrapper.name = "DeepSeek";
    h.wrapper.thought = qwenThought({ openOnResponseStart: true });
    await call({ thinking: { enabled: false } });
    expect(h.record.grammarTexts[1].split("\n")[0]).toBe(
      "root ::= thinking-body <[1001]> thinking-gap thinking-json",
    );
  });

  it("rewrites a union of string literals as an enum before building the grammar", async () => {
    const zodStyle = {
      type: "object",
      properties: {
        label: { anyOf: [{ type: "string", const: "yes" }, { type: "string", const: "no" }] },
      },
    };
    await call({ responseFormat: { toJSONSchema: () => zodStyle } });
    expect(h.record.schemas).toEqual([
      { type: "object", properties: { label: { type: "string", enum: ["yes", "no"] } } },
    ]);
  });

  it("loosens the schema grammar's indentation rules", async () => {
    h.grammarWithIndentation = true;
    await call();
    expect(h.record.grammarTexts).toEqual([
      ['root ::= "[" whitespace-b-1-4-rule "]"', "whitespace-b-1-4-rule ::= [ \\t\\n]{0,64}"].join("\n"),
    ]);
  });

  it("keeps the grammar when the tool list is empty", async () => {
    await call({ tools: [] });
    expectPlainSchemaGrammar();
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
