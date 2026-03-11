import { describe, it, expect } from "vitest";
import { Model } from "../lib/model.js";
import { TextModel, textModels } from "../lib/models.js";
import { ModelConfig } from "../lib/strategies/types.js";
import { promptResult } from "../lib/types.js";

describe("Model", () => {
  describe("with a direct model name", () => {
    it("resolves a known model name directly", () => {
      const model = new Model("gpt-4o");
      expect(model.getResolvedModel()).toBe("gpt-4o");
      expect(model.getModel()).toBe("gpt-4o");
    });

    it("accepts an unknown model name without throwing", () => {
      const model = new Model("nonexistent-model" as any);
      expect(model.getResolvedModel()).toBe("nonexistent-model");
      expect(model.getProvider()).toBeUndefined();
    });
  });

  describe("with a ModelConfig", () => {
    // Models with clear tradeoffs: cheap-slow, expensive-fast, balanced mid-range
    const fakeModels: TextModel[] = [
      {
        type: "text",
        modelName: "cheap-slow",
        provider: "openai",
        maxInputTokens: 8000,
        maxOutputTokens: 4000,
        inputTokenCost: 0.1,
        outputTokenCost: 0.2,
        outputTokensPerSecond: 50,
      },
      {
        type: "text",
        modelName: "expensive-fast",
        provider: "openai",
        maxInputTokens: 128000,
        maxOutputTokens: 16000,
        inputTokenCost: 10,
        outputTokenCost: 20,
        outputTokensPerSecond: 200,
      },
      {
        type: "text",
        modelName: "mid-google",
        provider: "google",
        maxInputTokens: 1000000,
        maxOutputTokens: 8000,
        inputTokenCost: 1,
        outputTokenCost: 3,
        outputTokensPerSecond: 150,
      },
      {
        type: "text",
        modelName: "disabled-model",
        provider: "openai",
        maxInputTokens: 200000,
        maxOutputTokens: 100000,
        inputTokenCost: 0.01,
        outputTokenCost: 0.01,
        outputTokensPerSecond: 500,
        disabled: true,
      },
    ];

    it("filters by provider", () => {
      const config: ModelConfig = {
        optimizeFor: ["cost"],
        providers: ["google"],
      };
      const model = new Model(config);
      expect(model.resolveModel(fakeModels)).toBe("mid-google");
    });

    it("excludes disabled models", () => {
      const config: ModelConfig = {
        optimizeFor: ["cost"],
        providers: ["openai"],
      };
      const model = new Model(config);
      const resolved = model.resolveModel(fakeModels);
      expect(resolved).not.toBe("disabled-model");
    });

    it("optimizes for cost — picks cheapest model", () => {
      const config: ModelConfig = {
        optimizeFor: ["cost"],
        providers: ["openai", "google"],
      };
      const model = new Model(config);
      expect(model.resolveModel(fakeModels)).toBe("cheap-slow");
    });

    it("optimizes for speed — picks fastest model", () => {
      const config: ModelConfig = {
        optimizeFor: ["speed"],
        providers: ["openai", "google"],
      };
      const model = new Model(config);
      expect(model.resolveModel(fakeModels)).toBe("expensive-fast");
    });

    it("optimizes for large-context — picks largest context model", () => {
      const config: ModelConfig = {
        optimizeFor: ["large-context"],
        providers: ["openai", "google"],
      };
      const model = new Model(config);
      expect(model.resolveModel(fakeModels)).toBe("mid-google");
    });

    it("optimizes for reasoning — picks most expensive (proxy for quality)", () => {
      const config: ModelConfig = {
        optimizeFor: ["reasoning"],
        providers: ["openai"],
      };
      const model = new Model(config);
      expect(model.resolveModel(fakeModels)).toBe("expensive-fast");
    });

    it("respects cost limit", () => {
      const config: ModelConfig = {
        optimizeFor: ["reasoning"],
        providers: ["openai"],
        limit: { cost: 5 },
      };
      const model = new Model(config);
      expect(model.resolveModel(fakeModels)).toBe("cheap-slow");
    });

    it("throws when no models match provider filter", () => {
      const config: ModelConfig = {
        optimizeFor: ["cost"],
        providers: ["anthropic"],
      };
      const model = new Model(config);
      expect(() => model.resolveModel(fakeModels)).toThrow(
        /No models available/,
      );
    });

    it("throws when cost limit filters out all models", () => {
      const config: ModelConfig = {
        optimizeFor: ["cost"],
        providers: ["openai"],
        limit: { cost: 0.001 },
      };
      expect(() => new Model(config)).toThrow(/No models available/);
    });

    it("balances cost and speed with weighted scoring", () => {
      // cheap-slow: cost=0.3 (best), speed=50 (worst)
      // expensive-fast: cost=30 (worst), speed=200 (best)
      // mid-google: cost=4 (middle), speed=150 (middle)
      // mid-google should win as a balanced choice
      const config: ModelConfig = {
        optimizeFor: ["cost", "speed"],
        providers: ["openai", "google"],
      };
      const model = new Model(config);
      expect(model.resolveModel(fakeModels)).toBe("mid-google");
    });

    it("first criterion has higher weight than second", () => {
      // speed first, cost second -> should favor speed more
      const speedFirstModel = new Model({
        optimizeFor: ["speed", "cost"],
        providers: ["openai", "google"],
      });
      const speedFirst = speedFirstModel.resolveModel(fakeModels);

      // cost first, speed second -> should favor cost more
      const costFirstModel = new Model({
        optimizeFor: ["cost", "speed"],
        providers: ["openai", "google"],
      });
      const costFirst = costFirstModel.resolveModel(fakeModels);

      // speed-first should not pick the cheapest-but-slowest model
      expect(speedFirst).not.toBe("cheap-slow");
      // cost-first should not pick the most-expensive model
      expect(costFirst).not.toBe("expensive-fast");
    });

    it("handles three optimization criteria", () => {
      const config: ModelConfig = {
        optimizeFor: ["cost", "speed", "large-context"],
        providers: ["openai", "google"],
      };
      const model = new Model(config);
      // mid-google is balanced across all three dimensions
      expect(model.resolveModel(fakeModels)).toBe("mid-google");
    });

    it("returns the only candidate when just one matches", () => {
      const singleModel: TextModel[] = [
        {
          type: "text",
          modelName: "only-one",
          provider: "openai",
          maxInputTokens: 4000,
          maxOutputTokens: 4000,
        },
      ];
      const config: ModelConfig = {
        optimizeFor: ["cost"],
        providers: ["openai"],
      };
      const model = new Model(config);
      expect(model.resolveModel(singleModel)).toBe("only-one");
    });

    it("works with the real textModels registry", () => {
      const config: ModelConfig = {
        optimizeFor: ["cost"],
        providers: ["openai"],
      };
      const model = new Model(config);
      const result = model.resolveModel();
      expect(typeof result).toBe("string");
      const found = textModels.find((m) => m.modelName === result);
      expect(found).toBeDefined();
      expect("disabled" in found! && found.disabled).not.toBe(true);
    });
  });

  describe("calculateCost", () => {
    it("calculates cost for a known text model", () => {
      const model = new Model("gpt-4o");
      const cost = model.calculateCost({
        inputTokens: 1_000_000,
        outputTokens: 500_000,
      });
      expect(cost).not.toBeNull();
      expect(cost!.currency).toBe("USD");
      expect(cost!.inputCost).toBeGreaterThan(0);
      expect(cost!.outputCost).toBeGreaterThan(0);
      expect(cost!.totalCost).toBe(cost!.inputCost + cost!.outputCost);
    });

    it("includes cached input cost when provided", () => {
      const model = new Model("gpt-4o");
      const cost = model.calculateCost({
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        cachedInputTokens: 200_000,
      });
      expect(cost).not.toBeNull();
      expect(cost!.cachedInputCost).toBeDefined();
      expect(cost!.cachedInputCost).toBeGreaterThan(0);
    });

    it("returns null for non-text models", () => {
      // Image models don't have text pricing
      const model = new Model("gpt-image-1" as any);
      const cost = model.calculateCost({
        inputTokens: 1000,
        outputTokens: 500,
      });
      expect(cost).toBeNull();
    });
  });

  describe("static create", () => {
    it("returns the same instance when given a Model", () => {
      const original = new Model("gpt-4o");
      const result = Model.create(original);
      expect(result).toBe(original);
    });

    it("creates a new Model from a model name string", () => {
      const result = Model.create("gpt-4o");
      expect(result).toBeInstanceOf(Model);
      expect(result.getResolvedModel()).toBe("gpt-4o");
    });

    it("creates a new Model from a ModelConfig", () => {
      const config: ModelConfig = {
        optimizeFor: ["cost"],
        providers: ["openai"],
      };
      const result = Model.create(config);
      expect(result).toBeInstanceOf(Model);
    });

    it("creates a new Model from a ModelNameAndProvider", () => {
      const result = Model.create({ model: "my-custom-model", provider: "ollama" });
      expect(result).toBeInstanceOf(Model);
      expect(result.getResolvedModel()).toBe("my-custom-model");
      expect(result.getProvider()).toBe("ollama");
    });

    it("accepts an explicit provider override", () => {
      const result = Model.create("gpt-4o", "anthropic" as any);
      expect(result.getProvider()).toBe("anthropic");
    });
  });

  describe("getProvider()", () => {
    it("returns the provider inferred from model registry", () => {
      const model = new Model("gpt-4o");
      expect(model.getProvider()).toBe("openai");
    });

    it("returns the provider from ModelNameAndProvider", () => {
      const model = new Model({ model: "custom-model", provider: "ollama" });
      expect(model.getProvider()).toBe("ollama");
    });

    it("returns undefined for unknown model with no registry entry", () => {
      const model = new Model("nonexistent-model" as any);
      expect(model.getProvider()).toBeUndefined();
    });
  });

  describe("toString()", () => {
    it("returns a human-readable string for a model name", () => {
      const model = new Model("gpt-4o");
      expect(model.toString()).toContain("gpt-4o");
    });

    it("returns a human-readable string for a ModelNameAndProvider", () => {
      const model = new Model({ model: "my-model", provider: "ollama" });
      expect(model.toString()).toContain("my-model");
    });
  });
});

describe("promptResult()", () => {
  it("creates a PromptResult with output", () => {
    const result = promptResult({ output: "hello" });
    expect(result.output).toBe("hello");
    expect(result.toolCalls).toEqual([]);
  });

  it("defaults output to null when not provided", () => {
    const result = promptResult({});
    expect(result.output).toBeNull();
  });

  it("defaults toolCalls to empty array when not provided", () => {
    const result = promptResult({ output: "test" });
    expect(result.toolCalls).toEqual([]);
  });

  it("passes through optional fields", () => {
    const result = promptResult({
      output: "hi",
      usage: { inputTokens: 10, outputTokens: 5 },
      model: "gpt-4o",
    });
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(result.model).toBe("gpt-4o");
  });
});
