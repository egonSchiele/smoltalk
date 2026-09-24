import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * A draft model, `metadata.llamaCppDraftModel`, is loaded next to the main
 * model, and the main sequence is created with a predictor over the draft's
 * sequence. The first call for a model decides whether it has a draft; a
 * later call asking for a different one is warned and gets what exists.
 * Disposing the main model disposes the draft too.
 */

const h = vi.hoisted(() => ({
  loaded: [] as string[],
  disposed: [] as string[],
  sequenceOptions: [] as any[],
  predictorsFor: [] as string[],
  warnings: [] as string[],
  reset() {
    h.loaded = [];
    h.disposed = [];
    h.sequenceOptions = [];
    h.predictorsFor = [];
    h.warnings = [];
  },
}));

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
    constructor(draftSequence: any) {
      h.predictorsFor.push(draftSequence.owner);
    }
  }
  const makeModel = (modelPath: string) => ({
    async createContext() {
      return {
        totalSequences: 1,
        getSequence(options?: any) {
          h.sequenceOptions.push({ owner: modelPath, options });
          return {
            owner: modelPath,
            tokenMeter: { getState: () => ({ usedInputTokens: 1, usedOutputTokens: 1 }) },
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
      debug() {},
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
    expect(h.predictorsFor).toEqual(["/models/small.gguf"]);
    const main = h.sequenceOptions.find((s) => s.owner === "/models/big.gguf");
    expect(main.options.tokenPredictor).toBeDefined();
  });

  it("makes no predictor without a draft", async () => {
    await acquireModelEntry("/models", "big.gguf");
    expect(h.loaded).toEqual(["/models/big.gguf"]);
    expect(h.predictorsFor).toEqual([]);
    expect(h.sequenceOptions[0].options).toBeUndefined();
  });

  it("reads the draft from the call's metadata", async () => {
    const client = new LlamaCPP({
      model: "big.gguf",
      messages,
      metadata: { llamaCppModelDir: "/models", llamaCppDraftModel: "/models/small.gguf" },
    });
    await client.text({ model: "big.gguf", messages } as any);
    expect(h.loaded).toEqual(["/models/big.gguf", "/models/small.gguf"]);
  });

  it("keeps the first call's draft and warns a later call asking otherwise", async () => {
    await acquireModelEntry("/models", "big.gguf", undefined, "/models/small.gguf");
    await acquireModelEntry("/models", "big.gguf", undefined, "/models/other.gguf");
    await acquireModelEntry("/models", "big.gguf");
    expect(h.loaded).toEqual(["/models/big.gguf", "/models/small.gguf"]);
    expect(h.warnings.length).toBe(2);
    expect(h.warnings[0]).toContain("already loaded with draft model /models/small.gguf");
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
