import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * A draft model, `metadata.llamaCppDraftModel`, is loaded next to the main
 * model, checked against it, given a context of the same size, and the main
 * sequence is created with a predictor over the draft's sequence. The first
 * call for a model decides whether it has a draft; a later call asking for
 * a different one is warned, and told how to change it, and gets what
 * exists. Disposing the main model disposes the draft too.
 */

const h = vi.hoisted(() => ({
  loaded: [] as string[],
  disposed: [] as string[],
  contextOptions: [] as any[],
  sequenceOptions: [] as any[],
  predictors: [] as any[],
  warnings: [] as string[],
  debugs: [] as string[],
  // What each model reports about its tokenizer, by path, so a draft can
  // be made to mismatch.
  vocab: {} as Record<string, any>,
  reset() {
    h.loaded = [];
    h.disposed = [];
    h.contextOptions = [];
    h.sequenceOptions = [];
    h.predictors = [];
    h.warnings = [];
    h.debugs = [];
    h.vocab = {};
  },
}));

const SAME_FAMILY = {
  vocabularyType: "bpe",
  tokens: { bos: 1, eos: 2, shouldPrependBosToken: true, shouldAppendEosToken: false },
};

vi.mock("node-llama-cpp", () => {
  class LlamaChat {
    constructor(_opts: any) {}
    async generateResponse(_history: any[], options: any) {
      options?.onTextChunk?.("answer");
      return { response: "answer", fullResponse: ["answer"], functionCalls: undefined };
    }
    dispose() {}
  }
  class DraftSequenceTokenPredictor {
    constructor(draftSequence: any, options: any) {
      h.predictors.push({ owner: draftSequence.owner, options });
    }
  }
  const makeModel = (modelPath: string) => ({
    filename: modelPath,
    ...(h.vocab[modelPath] ?? SAME_FAMILY),
    async createContext(options: any) {
      h.contextOptions.push({ owner: modelPath, options });
      return {
        contextSize: 4096,
        totalSequences: 1,
        getSequence(sequenceOptions?: any) {
          h.sequenceOptions.push({ owner: modelPath, options: sequenceOptions });
          return {
            owner: modelPath,
            tokenMeter: { getState: () => ({ usedInputTokens: 1, usedOutputTokens: 1 }) },
            tokenPredictions: { validated: 7, refuted: 2, used: 9, unused: 0 },
            async clearHistory() {},
          };
        },
        async dispose() {
          h.disposed.push(`context:${modelPath}`);
        },
      };
    },
    async dispose() {
      h.disposed.push(`model:${modelPath}`);
    },
  });
  return {
    getLlama: async () => ({
      async loadModel({ modelPath }: { modelPath: string }) {
        h.loaded.push(modelPath);
        return makeModel(modelPath);
      },
    }),
    LlamaChat,
    LlamaLogLevel: { error: "error" },
    DraftSequenceTokenPredictor,
  };
});

vi.mock("smoltalk", async (importOriginal) => {
  const original = await importOriginal<typeof import("smoltalk")>();
  return {
    ...original,
    getLogger: () => ({
      warn: (...args: any[]) => h.warnings.push(args.join(" ")),
      debug: (...args: any[]) => h.debugs.push(args.join(" ")),
      info() {},
      error() {},
    }),
  };
});

import { LlamaCPP } from "./llamaCpp.js";
import { acquireModelEntry, disposeAll } from "./nativeRegistry.js";

const messages = [{ role: "user", content: "hi" }] as any;

beforeEach(() => h.reset());
afterEach(async () => {
  await disposeAll();
});

describe("draft models", () => {
  it("loads the draft next to the main model and drafts on the main sequence", async () => {
    await acquireModelEntry("/models", "big.gguf", undefined, "/models/small.gguf");
    expect(h.loaded).toEqual(["/models/big.gguf", "/models/small.gguf"]);
    expect(h.predictors[0].owner).toBe("/models/small.gguf");
    const main = h.sequenceOptions.find((s) => s.owner === "/models/big.gguf");
    expect(main.options.tokenPredictor).toBeDefined();
  });

  it("gives the draft a context of the main context's size", async () => {
    await acquireModelEntry("/models", "big.gguf", undefined, "/models/small.gguf");
    const draft = h.contextOptions.find((c) => c.owner === "/models/small.gguf");
    expect(draft.options).toEqual({ contextSize: 4096 });
  });

  it("passes the draft options to the predictor", async () => {
    await acquireModelEntry("/models", "big.gguf", undefined, "/models/small.gguf", {
      maxTokens: 4,
      minConfidence: 0.5,
    });
    expect(h.predictors[0].options).toEqual({ maxTokens: 4, minConfidence: 0.5 });
  });

  it("makes no predictor without a draft", async () => {
    await acquireModelEntry("/models", "big.gguf");
    expect(h.loaded).toEqual(["/models/big.gguf"]);
    expect(h.predictors).toEqual([]);
    expect(h.sequenceOptions[0].options).toBeUndefined();
  });

  it("refuses a draft from another family when it loads, and frees both models", async () => {
    h.vocab["/models/other.gguf"] = { ...SAME_FAMILY, tokens: { ...SAME_FAMILY.tokens, eos: 99 } };
    await expect(
      acquireModelEntry("/models", "big.gguf", undefined, "/models/other.gguf"),
    ).rejects.toThrow("its start and end tokens differ");
    expect(h.disposed).toEqual([
      "model:/models/other.gguf",
      "context:/models/big.gguf",
      "model:/models/big.gguf",
    ]);
    // The failed load is not cached: the next call loads again.
    h.reset();
    await acquireModelEntry("/models", "big.gguf");
    expect(h.loaded).toEqual(["/models/big.gguf"]);
  });

  it("reads the draft from the call's metadata, resolving a relative path against the model directory", async () => {
    const client = new LlamaCPP({
      model: "big.gguf",
      messages,
      metadata: { llamaCppModelDir: "/models", llamaCppDraftModel: "small.gguf" },
    });
    await client.text({ model: "big.gguf", messages } as any);
    expect(h.loaded).toEqual(["/models/big.gguf", "/models/small.gguf"]);
    expect(h.debugs.some((d) => d.includes("7 tokens accepted, 2 rejected"))).toBe(true);
  });

  it("refuses a URI-shaped draft with the resolveModel hint", () => {
    expect(
      () =>
        new LlamaCPP({
          model: "big.gguf",
          messages,
          metadata: { llamaCppModelDir: "/models", llamaCppDraftModel: "hf:org/small" },
        }),
    ).toThrow("call resolveModel() first");
  });

  it("keeps the first call's draft and tells a later call how to change it", async () => {
    await acquireModelEntry("/models", "big.gguf", undefined, "/models/small.gguf");
    await acquireModelEntry("/models", "big.gguf", undefined, "/models/other.gguf");
    await acquireModelEntry("/models", "big.gguf");
    expect(h.loaded).toEqual(["/models/big.gguf", "/models/small.gguf"]);
    expect(h.warnings.length).toBe(2);
    expect(h.warnings[0]).toContain("already loaded with draft model /models/small.gguf");
    expect(h.warnings[0]).toContain('disposeModel("/models/big.gguf")');
  });

  it("disposes the draft with the main model", async () => {
    await acquireModelEntry("/models", "big.gguf", undefined, "/models/small.gguf");
    await disposeAll();
    expect(h.disposed).toEqual([
      "context:/models/big.gguf",
      "model:/models/big.gguf",
      "context:/models/small.gguf",
      "model:/models/small.gguf",
    ]);
  });
});
