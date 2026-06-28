import { describe, it, expect } from "vitest";
import type { TextModel } from "./models.js";

describe("extended model fields", () => {
  it("accepts the new optional metadata fields", () => {
    const m: TextModel = {
      type: "text",
      modelName: "x",
      provider: "openai",
      maxInputTokens: 1,
      maxOutputTokens: 1,
      knowledge: "2025-03-31",
      releaseDate: "2025-11-24",
      lastUpdated: "2025-11-24",
      family: "claude-opus",
      openWeights: false,
      modalities: { input: ["text", "image"], output: ["text"] },
      structuredOutput: true,
      temperatureSupported: true,
      inputAudioTokenCost: 1,
      outputAudioTokenCost: 2,
      longContext: { thresholdTokens: 200000, inputTokenCost: 4, outputTokenCost: 18 },
    };
    expect(m.family).toBe("claude-opus");
    expect(m.longContext?.thresholdTokens).toBe(200000);
  });
});
