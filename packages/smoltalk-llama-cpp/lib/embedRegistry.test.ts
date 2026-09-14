import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The embedding half of the native registry: one embedding context per
 * model file, never disposed on the call path, freed by disposeAll(). Same
 * mocking approach as nativeReuse.test.ts — a real GGUF can't load in CI.
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
    failCreateEmbeddingContextOnce: false, // createEmbeddingContext() rejects once
  };
  const reset = () => {
    for (const k of Object.keys(counters)) (counters as any)[k] = 0;
    flags.failCreateEmbeddingContextOnce = false;
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
  class FakeModel {
    async createEmbeddingContext() {
      counters.createEmbeddingContext += 1;
      if (h.flags.failCreateEmbeddingContextOnce) {
        h.flags.failCreateEmbeddingContextOnce = false;
        throw new Error("model has no embedding support");
      }
      return new FakeEmbeddingContext();
    }
    tokenize(text: string) {
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
        return new FakeModel();
      },
    }),
    LlamaLogLevel: { error: "error" },
  };
});

import { acquireEmbeddingEntry, disposeAll } from "./nativeRegistry.js";

beforeEach(() => h.reset());
afterEach(async () => {
  await disposeAll();
});

describe("acquireEmbeddingEntry", () => {
  it("loads the model and creates one embedding context per path", async () => {
    // Concurrent first calls must share one load: the registry stores the
    // promise, not the resolved entry.
    const [a, b] = await Promise.all([
      acquireEmbeddingEntry("/m/emb.gguf"),
      acquireEmbeddingEntry("/m/emb.gguf"),
    ]);
    const c = await acquireEmbeddingEntry("/m/emb.gguf");
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(h.counters.loadModel).toBe(1);
    expect(h.counters.createEmbeddingContext).toBe(1);
  });

  it("disposes the loaded model when context creation fails, then retries", async () => {
    h.flags.failCreateEmbeddingContextOnce = true;
    await expect(acquireEmbeddingEntry("/m/emb.gguf")).rejects.toThrow(
      "no embedding support",
    );
    expect(h.counters.modelDispose).toBe(1);
    // The failed entry is gone from the registry, so the next call reloads.
    await acquireEmbeddingEntry("/m/emb.gguf");
    expect(h.counters.loadModel).toBe(2);
    expect(h.counters.createEmbeddingContext).toBe(2);
  });

  it("keeps entries for different paths apart", async () => {
    await acquireEmbeddingEntry("/m/one.gguf");
    await acquireEmbeddingEntry("/m/two.gguf");
    expect(h.counters.loadModel).toBe(2);
  });

  it("disposeAll disposes the context and the model", async () => {
    await acquireEmbeddingEntry("/m/emb.gguf");
    await disposeAll();
    expect(h.counters.contextDispose).toBe(1);
    expect(h.counters.modelDispose).toBe(1);
    // A later acquire loads again.
    await acquireEmbeddingEntry("/m/emb.gguf");
    expect(h.counters.loadModel).toBe(2);
  });
});
