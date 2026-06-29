import { describe, it, expect } from "vitest";
import { embed, registerEmbeddingProvider } from "./embed.js";
import { success } from "./types/result.js";

describe("registerEmbeddingProvider", () => {
  it("dispatches to a registered custom provider", async () => {
    let received: unknown;
    registerEmbeddingProvider("fake-embed", async (inputs, config) => {
      received = { inputs, model: config.model };
      return success({ embeddings: inputs.map(() => [1, 2, 3]), model: config.model });
    });
    const result = await embed(["a", "b"], { provider: "fake-embed", model: "my-model" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.embeddings).toHaveLength(2);
      expect(result.value.model).toBe("my-model");
    }
    expect(received).toEqual({ inputs: ["a", "b"], model: "my-model" });
  });

  it("does not let a registered provider override a built-in", async () => {
    // Registering "openai" must NOT shadow the built-in openai path. Clear the
    // key so the built-in takes its fast key-error branch (no network), which
    // also proves the registered fn was never called — deterministic regardless
    // of any ambient OPENAI_API_KEY.
    const savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      let called = false;
      registerEmbeddingProvider("openai", async (inputs, config) => {
        called = true;
        return success({ embeddings: [[0]], model: config.model });
      });
      const result = await embed(["a"], { provider: "openai", model: "text-embedding-3-small" });
      expect(called).toBe(false);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain("OpenAI API key");
    } finally {
      if (savedKey !== undefined) {
        process.env.OPENAI_API_KEY = savedKey;
      }
    }
  });

  it("fails helpfully for an unregistered custom provider", async () => {
    const result = await embed(["a"], { provider: "no-such-embed", model: "x" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("registerEmbeddingProvider");
  });
});
