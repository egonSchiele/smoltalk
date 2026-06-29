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

describe("baked-in hosted-tool catalog", () => {
  it("covers the three cloud providers with valid entries", () => {
    const providers = new Set(hostedTools.map((t) => t.provider));
    expect(providers.has("anthropic")).toBe(true);
    expect(providers.has("openai-responses")).toBe(true); // OpenAI hosted tools are Responses-API tools
    expect(providers.has("google")).toBe(true);
  });

  it("every entry has a known unit and no duplicate (provider, name)", () => {
    const UNITS = new Set(["per_call", "per_session", "per_hour", "per_gb_day", "tokens", "free"]);
    const seen = new Set<string>();
    for (const t of hostedTools) {
      expect(t.pricing?.unit, t.name).toBeDefined();
      expect(UNITS.has(t.pricing!.unit), `${t.name} unit`).toBe(true);
      const key = `${t.provider}:${t.name}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });

  it("maps_grounding is gated to the Gemini 3 family", () => {
    const maps = hostedTools.find((t) => t.name === "maps_grounding");
    expect(maps?.models?.length).toBeGreaterThan(0);
    expect(maps?.models?.every((m) => m.startsWith("gemini-3"))).toBe(true);
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
