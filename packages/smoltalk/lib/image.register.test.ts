import { describe, it, expect } from "vitest";
import { image, registerImageProvider } from "./image.js";
import { success } from "./types/result.js";

describe("registerImageProvider", () => {
  it("dispatches to a registered custom provider", async () => {
    let received: unknown;
    registerImageProvider("fake-image", async (input, config) => {
      received = { input, model: config.model };
      return success({
        images: [{ data: new Uint8Array([1]), mimeType: "image/png" }],
        model: config.model,
      });
    });
    const result = await image("a cat", { provider: "fake-image", model: "my-model" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.images).toHaveLength(1);
      expect(result.value.model).toBe("my-model");
    }
    expect(received).toEqual({ input: "a cat", model: "my-model" });
  });

  it("does not let a registered provider override a built-in", async () => {
    // Clear the key so the built-in openai path takes its fast key-error branch
    // (no network) — deterministic regardless of any ambient OPENAI_API_KEY.
    const savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      let called = false;
      registerImageProvider("openai", async (input, config) => {
        called = true;
        return success({ images: [], model: config.model });
      });
      const result = await image("a cat", { provider: "openai", model: "gpt-image-1" });
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
    const result = await image("a cat", { provider: "no-such-image", model: "x" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("registerImageProvider");
  });
});
