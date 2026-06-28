import { describe, it, expect } from "vitest";
import { Model } from "./model.js";
import type { ModelDataBlob } from "./modelData.js";

const override: ModelDataBlob = {
  schemaVersion: 1,
  generatedAt: "x",
  models: [{ type: "text", modelName: "claude-opus-4-8", provider: "anthropic", inputTokenCost: 100, outputTokenCost: 200 } as any],
  hostedTools: [],
};

describe("Model with per-request modelData", () => {
  it("uses overridden pricing in calculateCost", () => {
    const withOverride = new Model("claude-opus-4-8", undefined, override);
    const cost = withOverride.calculateCost({ inputTokens: 1_000_000, outputTokens: 0 });
    expect(cost?.inputCost).toBe(100);
  });

  it("falls back to baked-in pricing without modelData", () => {
    const plain = new Model("claude-opus-4-8");
    const cost = plain.calculateCost({ inputTokens: 1_000_000, outputTokens: 0 });
    expect(cost?.inputCost).toBe(5);
  });

  it("resolves provider for a model only present in modelData", () => {
    const blob: ModelDataBlob = { schemaVersion: 1, generatedAt: "x", models: [{ type: "text", modelName: "new-x", provider: "google" } as any], hostedTools: [] };
    const m = new Model("new-x", undefined, blob);
    expect(m.getProvider()).toBe("google");
  });
});
