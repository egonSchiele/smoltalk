import { describe, expect, it } from "vitest";
import { isModelConfig, pickModel, textModels } from "./models.js";

// Small fixture models for controlled tests
const testModels = [
  {
    type: "text" as const,
    modelName: "cheap-slow" as const,
    provider: "openai" as const,
    maxInputTokens: 8000,
    maxOutputTokens: 4000,
    inputTokenCost: 0.1,
    outputTokenCost: 0.2,
    outputTokensPerSecond: 50,
  },
  {
    type: "text" as const,
    modelName: "expensive-fast" as const,
    provider: "openai" as const,
    maxInputTokens: 128000,
    maxOutputTokens: 16000,
    inputTokenCost: 10,
    outputTokenCost: 20,
    outputTokensPerSecond: 200,
  },
  {
    type: "text" as const,
    modelName: "mid-google" as const,
    provider: "google" as const,
    maxInputTokens: 1_000_000,
    maxOutputTokens: 8000,
    inputTokenCost: 1,
    outputTokenCost: 3,
    outputTokensPerSecond: 150,
  },
  {
    type: "text" as const,
    modelName: "disabled-model" as const,
    provider: "openai" as const,
    maxInputTokens: 200000,
    maxOutputTokens: 100000,
    inputTokenCost: 0.01,
    outputTokenCost: 0.01,
    outputTokensPerSecond: 500,
    disabled: true as const,
  },
] as const;

describe("pickModel", () => {
  it("picks the cheapest model when optimizing for cost", () => {
    const result = pickModel(
      { optimizeFor: ["cost"], providers: ["openai", "google"] },
      testModels,
    );
    expect(result).toBe("cheap-slow");
  });

  it("picks the fastest model when optimizing for speed", () => {
    const result = pickModel(
      { optimizeFor: ["speed"], providers: ["openai", "google"] },
      testModels,
    );
    expect(result).toBe("expensive-fast");
  });

  it("picks the most expensive model when optimizing for accuracy", () => {
    const result = pickModel(
      { optimizeFor: ["accuracy"], providers: ["openai", "google"] },
      testModels,
    );
    expect(result).toBe("expensive-fast");
  });

  it("picks the largest context model when optimizing for large-context", () => {
    const result = pickModel(
      { optimizeFor: ["large-context"], providers: ["openai", "google"] },
      testModels,
    );
    expect(result).toBe("mid-google");
  });

  it("filters by provider", () => {
    const result = pickModel(
      { optimizeFor: ["cost"], providers: ["google"] },
      testModels,
    );
    expect(result).toBe("mid-google");
  });

  it("excludes disabled models", () => {
    // disabled-model is cheapest + fastest but should be excluded
    const result = pickModel(
      { optimizeFor: ["cost"], providers: ["openai"] },
      testModels,
    );
    expect(result).toBe("cheap-slow");
  });

  it("throws when no models match the providers", () => {
    expect(() =>
      pickModel(
        { optimizeFor: ["cost"], providers: ["anthropic"] },
        testModels,
      ),
    ).toThrow(/No models available/);
  });

  it("returns the only candidate when one model matches", () => {
    const result = pickModel(
      { optimizeFor: ["speed"], providers: ["google"] },
      testModels,
    );
    expect(result).toBe("mid-google");
  });

  it("balances cost and speed with weighted scoring", () => {
    // cost weight=0.6, speed weight=0.4
    // cheap-slow: cost=0.3 (best), speed=50 (worst)
    // expensive-fast: cost=30 (worst), speed=200 (best)
    // mid-google: cost=4 (middle), speed=150 (middle)
    // mid-google should win as a balanced choice
    const result = pickModel(
      { optimizeFor: ["cost", "speed"], providers: ["openai", "google"] },
      testModels,
    );
    expect(result).toBe("mid-google");
  });

  it("first criterion has higher weight than second", () => {
    // speed first, cost second -> should favor speed more
    const speedFirst = pickModel(
      { optimizeFor: ["speed", "cost"], providers: ["openai", "google"] },
      testModels,
    );
    // cost first, speed second -> should favor cost more
    const costFirst = pickModel(
      { optimizeFor: ["cost", "speed"], providers: ["openai", "google"] },
      testModels,
    );
    // With different priority orders, at least the results should reflect the weighting
    // speed-first should not pick the cheapest-but-slowest model
    expect(speedFirst).not.toBe("cheap-slow");
    // cost-first should not pick the most-expensive model
    expect(costFirst).not.toBe("expensive-fast");
  });

  it("handles three optimization criteria", () => {
    const result = pickModel(
      {
        optimizeFor: ["cost", "speed", "large-context"],
        providers: ["openai", "google"],
      },
      testModels,
    );
    // mid-google is balanced across all three dimensions
    expect(result).toBe("mid-google");
  });

  it("works with the real textModels registry", () => {
    const result = pickModel({
      optimizeFor: ["cost"],
      providers: ["openai"],
    });
    // Should return a string model name
    expect(typeof result).toBe("string");
    // Should not be a disabled model
    const model = textModels.find((m) => m.modelName === result);
    expect(model).toBeDefined();
    expect("disabled" in model! && model.disabled).not.toBe(true);
  });
});

describe("isModelConfig", () => {
  it("returns true for ModelConfig objects", () => {
    expect(
      isModelConfig({ optimizeFor: ["cost"], providers: ["openai"] }),
    ).toBe(true);
  });

  it("returns false for string model names", () => {
    expect(isModelConfig("gpt-4o" as any)).toBe(false);
  });
});
