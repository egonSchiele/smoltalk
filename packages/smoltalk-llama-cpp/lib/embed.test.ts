import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The `embed` export: one vector per input in order, token counts from the
 * model tokenizer, calls serialized per model, `dimensions` truncation, and
 * the two failure messages. node-llama-cpp is mocked as in
 * embedRegistry.test.ts, plus a fault flag on loadModel.
 */

const h = vi.hoisted(() => {
  const counters = {
    loadModel: 0,
    createEmbeddingContext: 0,
    getEmbeddingFor: 0,
    contextDispose: 0,
    modelDispose: 0,
    active: 0,
    maxActive: 0,
  };
  const flags = {
    failLoadModelOnce: false, // first loadModel() rejects, then recovers
  };
  const reset = () => {
    for (const k of Object.keys(counters)) (counters as any)[k] = 0;
    flags.failLoadModelOnce = false;
  };
  return { counters, flags, reset };
});

vi.mock("node-llama-cpp", () => {
  const { counters } = h;
  class FakeEmbeddingContext {
    disposed = false;
    async getEmbeddingFor(text: string) {
      counters.getEmbeddingFor += 1;
      counters.active += 1;
      counters.maxActive = Math.max(counters.maxActive, counters.active);
      await new Promise((r) => setTimeout(r, 5));
      counters.active -= 1;
      return { vector: [text.length, 1, 0] };
    }
    async dispose() {
      counters.contextDispose += 1;
      this.disposed = true;
    }
  }
  // An spm-style model that prepends BOS and appends nothing, so every
  // non-empty input costs one token more than its raw tokenization.
  class FakeModel {
    vocabularyType = "spm";
    tokens = {
      bos: "<s>",
      eos: "</s>",
      sep: null,
      shouldPrependBosToken: true,
      shouldAppendEosToken: false,
    };
    async createEmbeddingContext() {
      counters.createEmbeddingContext += 1;
      return new FakeEmbeddingContext();
    }
    tokenize(text: string) {
      if (text === "") {
        return [];
      }
      return text.split(" ");
    }
    async dispose() {
      counters.modelDispose += 1;
    }
  }
  return {
    getLlama: async () => ({
      loadModel: async () => {
        counters.loadModel += 1;
        if (h.flags.failLoadModelOnce) {
          h.flags.failLoadModelOnce = false;
          throw new Error("bad magic");
        }
        return new FakeModel();
      },
    }),
    LlamaLogLevel: { error: "error" },
    LlamaVocabularyType: {
      none: "none",
      spm: "spm",
      bpe: "bpe",
      wpm: "wpm",
      ugm: "ugm",
      rwkv: "rwkv",
      plamo2: "plamo2",
    },
  };
});

import { embed } from "./embed.js";
import { disposeAll } from "./nativeRegistry.js";

beforeEach(() => h.reset());
afterEach(async () => {
  await disposeAll();
});

describe("embed", () => {
  it("returns one vector per input, in order, with token counts", async () => {
    const result = await embed(["one two", "three"], { model: "/m/emb.gguf" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.embeddings).toEqual([
        [7, 1, 0],
        [5, 1, 0],
      ]);
      expect(result.value.model).toBe("/m/emb.gguf");
      // 2 + 1 raw tokens, plus the BOS getEmbeddingFor prepends to each.
      expect(result.value.tokenUsage).toEqual({ inputTokens: 5, outputTokens: 0 });
      expect(result.value.costEstimate).toEqual({
        inputCost: 0,
        outputCost: 0,
        totalCost: 0,
        currency: "USD",
      });
    }
  });

  it("serializes calls on one model", async () => {
    await Promise.all([
      embed(["a"], { model: "/m/emb.gguf" }),
      embed(["b"], { model: "/m/emb.gguf" }),
      embed(["c"], { model: "/m/emb.gguf" }),
    ]);
    expect(h.counters.getEmbeddingFor).toBe(3);
    expect(h.counters.maxActive).toBe(1);
  });

  it("truncates to dimensions and renormalizes", async () => {
    const result = await embed(["x"], { model: "/m/emb.gguf", dimensions: 2 });
    expect(result.success).toBe(true);
    if (result.success) {
      const [a, b] = result.value.embeddings[0];
      expect(result.value.embeddings[0]).toHaveLength(2);
      expect(Math.sqrt(a * a + b * b)).toBeCloseTo(1, 6);
    }
  });

  it("does not count a BOS the text already starts with, nor empty text", async () => {
    const result = await embed(["<s> hi", ""], { model: "/m/emb.gguf" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.tokenUsage).toEqual({ inputTokens: 2, outputTokens: 0 });
    }
  });

  it("rejects a non-positive or fractional dimensions before loading", async () => {
    for (const dimensions of [0, -1, 1.5]) {
      const result = await embed(["x"], { model: "/m/emb.gguf", dimensions });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("positive integer");
      }
    }
    expect(h.counters.loadModel).toBe(0);
  });

  it("refuses a URI-shaped model and names resolveModel", async () => {
    const result = await embed(["x"], { model: "hf:org/repo:Q4_K_M" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("resolveModel()");
    }
  });

  it("returns a failure when the model cannot load", async () => {
    h.flags.failLoadModelOnce = true;
    const result = await embed(["x"], { model: "/m/broken.gguf" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("/m/broken.gguf");
    }
  });
});
