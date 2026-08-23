import { describe, it, expect } from "vitest";
import { Model } from "../lib/model.js";
import { promptResult } from "../lib/types.js";

describe("Model", () => {
  describe("with a direct model name", () => {
    it("stores a known model name", () => {
      const model = new Model("gpt-4o");
      expect(model.getModel()).toBe("gpt-4o");
    });

    it("accepts an unknown model name that matches the schema regex", () => {
      const model = new Model("nonexistent-model" as any);
      expect(model.getModel()).toBe("nonexistent-model");
      expect(model.getProvider()).toBeUndefined();
    });

    it("throws on a model name that doesn't match the schema regex", () => {
      expect(() => new Model("bad name with spaces" as any)).toThrow(
        /not recognized/,
      );
    });

    it("throws on an empty model name", () => {
      expect(() => new Model("" as any)).toThrow(/not recognized/);
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

    it("computes disjoint-bucket cost for OpenAI with cached tokens", () => {
      // gpt-4o: inputTokenCost=2.50, cachedInputTokenCost=1.25, outputTokenCost=10
      // After client normalization, inputTokens is the uncached portion only.
      const model = new Model("gpt-4o");
      const cost = model.calculateCost({
        inputTokens: 800_000,
        outputTokens: 0,
        cachedInputTokens: 200_000,
      });
      expect(cost).not.toBeNull();
      // 800_000 @ $2.50/M = $2.00
      // 200_000 @ $1.25/M = $0.25
      expect(cost!.inputCost).toBeCloseTo(2.0, 6);
      expect(cost!.cachedInputCost).toBeCloseTo(0.25, 6);
      expect(cost!.totalCost).toBeCloseTo(2.25, 6);
    });

    it("computes disjoint-bucket cost for Gemini with cached tokens", () => {
      // gemini-2.5-flash: inputTokenCost=0.30, cachedInputTokenCost=0.03, outputTokenCost=2.50
      // After client normalization, inputTokens is the uncached portion only.
      const model = new Model("gemini-2.5-flash");
      const cost = model.calculateCost({
        inputTokens: 700_000,
        outputTokens: 0,
        cachedInputTokens: 300_000,
      });
      expect(cost).not.toBeNull();
      // 700_000 @ $0.30/M = $0.21
      // 300_000 @ $0.03/M = $0.009
      expect(cost!.inputCost).toBeCloseTo(0.21, 6);
      expect(cost!.cachedInputCost).toBeCloseTo(0.009, 6);
      expect(cost!.totalCost).toBeCloseTo(0.219, 6);
    });

    it("computes disjoint-bucket cost for Anthropic with cache reads + cache creation", () => {
      const model = new Model("claude-opus-4-7");
      // inputTokenCost=5, cachedInputTokenCost=0.5, cacheCreationInputTokenCost=6.25, outputTokenCost=25
      // All three buckets are disjoint; no subtraction needed.
      const cost = model.calculateCost({
        inputTokens: 500_000,
        outputTokens: 0,
        cachedInputTokens: 300_000,
        cacheCreationInputTokens: 200_000,
      });
      expect(cost).not.toBeNull();
      // 500_000 @ $5/M     = $2.50
      // 300_000 @ $0.50/M  = $0.15
      // 200_000 @ $6.25/M  = $1.25
      expect(cost!.inputCost).toBeCloseTo(2.5, 6);
      expect(cost!.cachedInputCost).toBeCloseTo(0.15, 6);
      expect(cost!.cacheCreationInputCost).toBeCloseTo(1.25, 6);
      expect(cost!.totalCost).toBeCloseTo(3.9, 6);
    });

    it("falls back to full input price when cache prices are missing", () => {
      // Legacy/disabled model without cachedInputTokenCost in the registry.
      // The provider still billed for those tokens, so we charge at the
      // full input rate to keep totalCost honest.
      const model = new Model("claude-3-5-haiku-latest");
      const cost = model.calculateCost({
        inputTokens: 800_000,
        outputTokens: 0,
        cachedInputTokens: 200_000,
      });
      expect(cost).not.toBeNull();
      // 800_000 + 200_000 @ $0.80/M = $0.80
      expect(cost!.totalCost).toBeCloseTo(0.8, 6);
    });

    it("falls back to the name-keyed catalog entry for an API-variant provider", () => {
      // gpt-5-mini is cataloged under provider "openai"; a client built with
      // the API-variant provider "openai-responses" must still find pricing.
      const variant = new Model("gpt-5-mini", "openai-responses");
      const family = new Model("gpt-5-mini", "openai");
      const usage = { inputTokens: 1000, outputTokens: 1000 };
      const variantCost = variant.calculateCost(usage);
      expect(variantCost).not.toBeNull();
      expect(variantCost).toEqual(family.calculateCost(usage));
    });

    it("still resolves a provider-keyed entry when one exists", () => {
      // o3-pro is cataloged under "openai-responses" itself; the exact
      // provider match must keep winning over any name-only fallback.
      const model = new Model("o3-pro", "openai-responses");
      const cost = model.calculateCost({
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      });
      expect(cost).not.toBeNull();
      // inputTokenCost=20, outputTokenCost=80
      expect(cost!.inputCost).toBeCloseTo(20, 6);
      expect(cost!.outputCost).toBeCloseTo(80, 6);
    });

    it("does not borrow pricing across unrelated providers", () => {
      // Gateways may price the same model name differently; only known
      // API-variant aliases fall back, everything else stays null.
      const model = new Model("gemini-2.5-flash", "openrouter");
      const cost = model.calculateCost({ inputTokens: 1000, outputTokens: 1000 });
      expect(cost).toBeNull();
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
