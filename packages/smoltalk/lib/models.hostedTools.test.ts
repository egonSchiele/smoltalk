import { describe, it, expect } from "vitest";
import { getHostedTools, hostedToolPricingFor, hostedTools } from "./models.js";
import type { ModelDataBlob } from "./modelData.js";

// Synthetic overlay passed per-call so tests don't depend on the baked catalog.
const blob: ModelDataBlob = {
  schemaVersion: 1,
  generatedAt: "x",
  models: [],
  hostedTools: [
    { name: "google_search", provider: "google", category: "web_search", pricing: { unit: "per_call", amount: 0.014, perModel: { "gemini-2.5-flash": { amount: 0.035 } } } },
    { name: "maps_grounding", provider: "google", category: "maps_grounding", models: ["gemini-3-pro-preview"], pricing: { unit: "per_call" } },
    { name: "old_tool", provider: "google", category: "web_search", disabled: true, pricing: { unit: "free" } },
  ] as any,
};

describe("getHostedTools filtering", () => {
  it("filters by provider", () => {
    const names = getHostedTools({ provider: "google", modelData: blob }).map((t) => t.name);
    expect(names).toContain("google_search");
    expect(names).not.toContain("web_search"); // anthropic baked tool excluded
  });

  it("filters by category", () => {
    const names = getHostedTools({ category: "maps_grounding", modelData: blob }).map((t) => t.name);
    expect(names).toEqual(["maps_grounding"]);
  });

  it("excludes disabled tools by default, includes them on request", () => {
    expect(getHostedTools({ modelData: blob }).map((t) => t.name)).not.toContain("old_tool");
    expect(getHostedTools({ includeDisabled: true, modelData: blob }).map((t) => t.name)).toContain("old_tool");
  });

  it("filters by model: provider match + models allowlist", () => {
    // gemini-2.5-flash is a baked google model; maps_grounding is Gemini-3-only -> excluded.
    const names = getHostedTools({ model: "gemini-2.5-flash", modelData: blob }).map((t) => t.name);
    expect(names).toContain("google_search");
    expect(names).not.toContain("maps_grounding");
  });

  it("returns a fresh array (no baseline mutation)", () => {
    const a = getHostedTools();
    a.push({ name: "x", provider: "y" } as any);
    expect(getHostedTools().map((t) => t.name)).not.toContain("x");
  });
});

describe("hostedToolPricingFor", () => {
  it("returns base pricing with perModel stripped", () => {
    const tool = { name: "google_search", provider: "google", pricing: { unit: "per_call", amount: 0.014, perModel: { "gemini-2.5-flash": { amount: 0.035 } } } } as any;
    const p = hostedToolPricingFor(tool);
    expect(p?.amount).toBe(0.014);
    expect(p?.perModel).toBeUndefined();
  });

  it("merges the per-model override over the base", () => {
    const tool = { name: "google_search", provider: "google", pricing: { unit: "per_call", amount: 0.014, perModel: { "gemini-2.5-flash": { amount: 0.035, note: "per prompt" } } } } as any;
    const p = hostedToolPricingFor(tool, "gemini-2.5-flash");
    expect(p?.amount).toBe(0.035);
    expect(p?.note).toBe("per prompt");
    expect(p?.unit).toBe("per_call");
    expect(p?.perModel).toBeUndefined();
  });
});
