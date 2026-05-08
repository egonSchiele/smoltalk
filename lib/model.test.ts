import { describe, it, expect } from "vitest";
import { Model } from "../lib/model.js";
import { promptResult } from "../lib/types.js";

describe("Model", () => {
  describe("with a direct model name", () => {
    it("resolves a known model name directly", () => {
      const model = new Model("gpt-4o");
      expect(model.getModel()).toBe("gpt-4o");
      expect(model.getModel()).toBe("gpt-4o");
    });

    it("accepts an unknown model name without throwing", () => {
      const model = new Model("nonexistent-model" as any);
      expect(model.getModel()).toBe("nonexistent-model");
      expect(model.getProvider()).toBeUndefined();
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
      expect(result.getModel()).toBe("gpt-4o");
    });

    it("creates a new Model from a model string with explicit provider", () => {
      const result = Model.create("my-custom-model" as any, "ollama" as any);
      expect(result).toBeInstanceOf(Model);
      expect(result.getModel()).toBe("my-custom-model");
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

    it("returns the explicit provider when passed", () => {
      const model = new Model("custom-model" as any, "ollama" as any);
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

    it("returns a human-readable string for a model with provider", () => {
      const model = new Model("my-model" as any, "ollama" as any);
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
