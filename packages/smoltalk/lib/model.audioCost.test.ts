import { describe, it, expect } from "vitest";
import { Model } from "./model.js";
import type { ModelDataBlob } from "./modelData.js";

const modelData: ModelDataBlob = {
  schemaVersion: 1,
  generatedAt: "test",
  models: [{
    type: "text",
    modelName: "audio-test",
    provider: "openai",
    maxInputTokens: 128_000,
    maxOutputTokens: 16_384,
    inputTokenCost: 2,      // $/1M text input
    outputTokenCost: 10,
    inputAudioTokenCost: 32, // $/1M audio input
    outputAudioTokenCost: 64,
  }],
  hostedTools: [],
};

const noAudioRateModelData: ModelDataBlob = {
  schemaVersion: 1,
  generatedAt: "test",
  models: [{
    type: "text",
    modelName: "no-audio-rate-test",
    provider: "openai",
    maxInputTokens: 128_000,
    maxOutputTokens: 16_384,
    inputTokenCost: 3,
    outputTokenCost: 12,
  }],
  hostedTools: [],
};

const plainModelData: ModelDataBlob = {
  schemaVersion: 1,
  generatedAt: "test",
  models: [{
    type: "text",
    modelName: "plain-test",
    provider: "openai",
    maxInputTokens: 128_000,
    maxOutputTokens: 16_384,
    inputTokenCost: 5,
    outputTokenCost: 15,
  }],
  hostedTools: [],
};

describe("calculateCost with audio tokens", () => {
  it("prices all four buckets disjointly", () => {
    const m = new Model("audio-test", "openai", modelData);
    const cost = m.calculateCost({
      inputTokens: 1_000_000, outputTokens: 1_000_000,
      inputAudioTokens: 1_000_000, outputAudioTokens: 1_000_000,
    })!;
    expect(cost.inputCost).toBe(34);
    expect(cost.outputCost).toBe(74);
    expect(cost.totalCost).toBe(108);
  });

  it("falls back to text rates when audio rates are undefined", () => {
    const m = new Model("no-audio-rate-test", "openai", noAudioRateModelData);
    const cost = m.calculateCost({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      inputAudioTokens: 1_000_000,
      outputAudioTokens: 1_000_000,
    })!;
    // audio buckets fold in at the text rate: 3 (input) + 3 (audio-in) = 6
    expect(cost.inputCost).toBe(6);
    // 12 (output) + 12 (audio-out) = 24
    expect(cost.outputCost).toBe(24);
    expect(cost.totalCost).toBe(30);
  });

  it("parses audio token fields through TokenUsageSchema", async () => {
    const { TokenUsageSchema } = await import("./types/tokenUsage.js");
    const parsed = TokenUsageSchema.parse({
      inputTokens: 100,
      outputTokens: 50,
      inputAudioTokens: 10,
      outputAudioTokens: 5,
    });
    expect(parsed.inputAudioTokens).toBe(10);
    expect(parsed.outputAudioTokens).toBe(5);
  });

  it("addTokenUsage sums audio token buckets", async () => {
    const { addTokenUsage } = await import("./types/tokenUsage.js");
    const sum = addTokenUsage(
      { inputTokens: 10, outputTokens: 5, inputAudioTokens: 3, outputAudioTokens: 2 },
      { inputTokens: 20, outputTokens: 8, inputAudioTokens: 7, outputAudioTokens: 4 },
    );
    expect(sum.inputAudioTokens).toBe(10);
    expect(sum.outputAudioTokens).toBe(6);
  });

  it("retains existing cached-token behavior with audio present", () => {
    const withCacheData: ModelDataBlob = {
      schemaVersion: 1,
      generatedAt: "test",
      models: [{
        type: "text",
        modelName: "audio-cache-test",
        provider: "openai",
        maxInputTokens: 128_000,
        maxOutputTokens: 16_384,
        inputTokenCost: 2,
        outputTokenCost: 10,
        cachedInputTokenCost: 1,
        inputAudioTokenCost: 32,
        outputAudioTokenCost: 64,
      }],
      hostedTools: [],
    };
    const m = new Model("audio-cache-test", "openai", withCacheData);
    const cost = m.calculateCost({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cachedInputTokens: 1_000_000,
      inputAudioTokens: 1_000_000,
      outputAudioTokens: 1_000_000,
    })!;
    // input: 2 (regular) + 32 (audio-in) = 34; cached is separate
    expect(cost.inputCost).toBe(34);
    expect(cost.cachedInputCost).toBe(1);
    expect(cost.outputCost).toBe(74);
    expect(cost.totalCost).toBe(109);
  });

  it("no usage produces no OpenAI usage/cost", () => {
    const m = new Model("audio-test", "openai", modelData);
    // calculateCost always returns a result for zeroed usage; this case is
    // about the OpenAI client not calling calculateCost at all when there's
    // no usageData — covered in openai.test.ts. Here we just confirm the
    // zero-usage math is exact.
    const cost = m.calculateCost({ inputTokens: 0, outputTokens: 0 })!;
    expect(cost.inputCost).toBe(0);
    expect(cost.outputCost).toBe(0);
    expect(cost.totalCost).toBe(0);
  });

  it("an ordinary non-audio model produces its unchanged known cost", () => {
    const m = new Model("plain-test", "openai", plainModelData);
    const cost = m.calculateCost({ inputTokens: 200_000, outputTokens: 100_000 })!;
    expect(cost.inputCost).toBe(1);
    expect(cost.outputCost).toBe(1.5);
    expect(cost.totalCost).toBe(2.5);
  });
});
