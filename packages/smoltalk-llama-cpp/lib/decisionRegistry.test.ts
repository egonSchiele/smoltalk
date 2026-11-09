import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The decision half of the native registry: one decision context per model
 * file, never disposed on the call path, freed by disposeModel() and
 * disposeAll(). Same mocking approach as embedRegistry.test.ts — a real GGUF
 * can't load in CI.
 */

const h = vi.hoisted(() => {
  const counters = {
    loadModel: 0,
    createDecisionContext: 0,
    contextDispose: 0,
    modelDispose: 0,
  };
  const flags = {
    failCreateDecisionContextOnce: false,
  };
  const reset = () => {
    for (const k of Object.keys(counters)) (counters as any)[k] = 0;
    flags.failCreateDecisionContextOnce = false;
  };
  return { counters, flags, reset };
});

vi.mock("node-llama-cpp", () => {
  const { counters } = h;
  class FakeDecisionContext {
    async dispose() {
      counters.contextDispose += 1;
    }
  }
  class FakeModel {
    async createDecisionContext() {
      counters.createDecisionContext += 1;
      if (h.flags.failCreateDecisionContextOnce) {
        h.flags.failCreateDecisionContextOnce = false;
        throw new Error("not enough memory for the context");
      }
      return new FakeDecisionContext();
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

import { acquireDecisionEntry, disposeAll, disposeModel } from "./nativeRegistry.js";

beforeEach(() => h.reset());
afterEach(async () => {
  await disposeAll();
});

describe("acquireDecisionEntry", () => {
  it("loads the model and creates one decision context per path", async () => {
    const [a, b] = await Promise.all([
      acquireDecisionEntry("/m/decide.gguf"),
      acquireDecisionEntry("/m/decide.gguf"),
    ]);
    const c = await acquireDecisionEntry("/m/decide.gguf");
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(h.counters.loadModel).toBe(1);
    expect(h.counters.createDecisionContext).toBe(1);
  });

  it("disposes the loaded model when context creation fails, then retries", async () => {
    h.flags.failCreateDecisionContextOnce = true;
    await expect(acquireDecisionEntry("/m/decide.gguf")).rejects.toThrow("not enough memory");
    expect(h.counters.modelDispose).toBe(1);
    await acquireDecisionEntry("/m/decide.gguf");
    expect(h.counters.loadModel).toBe(2);
    expect(h.counters.createDecisionContext).toBe(2);
  });

  it("keeps entries for different paths apart", async () => {
    await acquireDecisionEntry("/m/one.gguf");
    await acquireDecisionEntry("/m/two.gguf");
    expect(h.counters.loadModel).toBe(2);
  });

  it("disposeAll disposes the context and the model", async () => {
    await acquireDecisionEntry("/m/decide.gguf");
    await disposeAll();
    expect(h.counters.contextDispose).toBe(1);
    expect(h.counters.modelDispose).toBe(1);
    await acquireDecisionEntry("/m/decide.gguf");
    expect(h.counters.loadModel).toBe(2);
  });

  it("disposeModel disposes the decision entry for its path", async () => {
    await acquireDecisionEntry("/m/decide.gguf");
    await disposeModel("/m/decide.gguf");
    expect(h.counters.contextDispose).toBe(1);
    expect(h.counters.modelDispose).toBe(1);
  });
});
