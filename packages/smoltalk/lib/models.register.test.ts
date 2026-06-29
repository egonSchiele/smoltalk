import { describe, it, expect, afterEach } from "vitest";
import {
  getModel,
  getHostedTools,
  registerModelData,
  clearModelData,
} from "./models.js";

afterEach(() => clearModelData());

describe("registerModelData", () => {
  it("overrides baked-in pricing for an existing model", () => {
    const before = getModel("claude-opus-4-8");
    expect(before?.inputTokenCost).toBe(5);

    registerModelData({
      schemaVersion: 1,
      generatedAt: "x",
      models: [{ type: "text", modelName: "claude-opus-4-8", provider: "anthropic", inputTokenCost: 99 } as any],
      hostedTools: [],
    });

    const after = getModel("claude-opus-4-8");
    expect(after?.inputTokenCost).toBe(99);
    expect((after as any)?.maxInputTokens).toBe(1_000_000); // untouched
  });

  it("adds a brand-new model", () => {
    expect(getModel("totally-new-model")).toBeUndefined();
    registerModelData({
      schemaVersion: 1,
      generatedAt: "x",
      models: [{ type: "text", modelName: "totally-new-model", provider: "openai", inputTokenCost: 1, outputTokenCost: 2, maxInputTokens: 10, maxOutputTokens: 10 } as any],
      hostedTools: [],
    });
    expect(getModel("totally-new-model")?.provider).toBe("openai");
  });

  it("clearModelData restores the baseline", () => {
    registerModelData({ schemaVersion: 1, generatedAt: "x", models: [{ type: "text", modelName: "claude-opus-4-8", provider: "anthropic", inputTokenCost: 99 } as any], hostedTools: [] });
    clearModelData();
    expect(getModel("claude-opus-4-8")?.inputTokenCost).toBe(5);
  });

  it("per-call requestData overrides even the global layer", () => {
    registerModelData({ schemaVersion: 1, generatedAt: "x", models: [{ type: "text", modelName: "claude-opus-4-8", provider: "anthropic", inputTokenCost: 99 } as any], hostedTools: [] });
    const perCall = { schemaVersion: 1, generatedAt: "x", models: [{ type: "text", modelName: "claude-opus-4-8", provider: "anthropic", inputTokenCost: 7 } as any], hostedTools: [] };
    expect(getModel("claude-opus-4-8", perCall)?.inputTokenCost).toBe(7);
  });

  it("merges hosted tools from baseline, global, and request layers", () => {
    registerModelData({ schemaVersion: 1, generatedAt: "x", models: [], hostedTools: [{ name: "web_search", provider: "anthropic", pricing: { unit: "per_call", amount: 0.02 } } as any] });
    const tools = getHostedTools();
    const ws = tools.find((t) => t.name === "web_search");
    expect(ws?.pricing?.amount).toBe(0.02); // global overlay wins over baseline
  });
});
