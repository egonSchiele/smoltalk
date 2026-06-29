import { describe, it, expect } from "vitest";
import { validateHostedTools, estimateHostedToolCost, foldHostedToolCost, webSearchResult, applyHostedToolCost } from "./hostedTools.js";
import type { HostedToolResult } from "../types.js";

describe("validateHostedTools", () => {
  it("accepts web_search for a supporting model", () => {
    expect(validateHostedTools(["web_search"], "claude-opus-4-8")).toBeNull();
  });
  it("accepts web_search for a google model (matched by category)", () => {
    expect(validateHostedTools(["web_search"], "gemini-2.5-flash")).toBeNull();
  });
  it("rejects web_search for an unknown model / provider with no such tool", () => {
    const msg = validateHostedTools(["web_search"], "totally-unknown-model");
    expect(msg).toContain("web_search");
  });
  it("rejects an unimplemented capability", () => {
    expect(validateHostedTools(["code_execution"], "claude-opus-4-8")).toContain("not yet supported");
  });
  it("rejects an unknown capability", () => {
    expect(validateHostedTools(["nonsense"], "claude-opus-4-8")).toContain("Unknown");
  });
  it("returns null for empty/undefined", () => {
    expect(validateHostedTools(undefined, "claude-opus-4-8")).toBeNull();
    expect(validateHostedTools([], "claude-opus-4-8")).toBeNull();
  });
});

describe("estimateHostedToolCost", () => {
  it("computes callCount x per-call price", () => {
    const r: HostedToolResult = { tool: "web_search", provider: "anthropic", callCount: 3 };
    expect(estimateHostedToolCost(r, "claude-opus-4-8")).toBeCloseTo(0.03, 6);
  });
  it("applies per-model overrides (gemini 2.5 = $0.035)", () => {
    const r: HostedToolResult = { tool: "web_search", provider: "google", callCount: 1 };
    expect(estimateHostedToolCost(r, "gemini-2.5-flash")).toBeCloseTo(0.035, 6);
  });
  it("returns undefined without a callCount", () => {
    const r: HostedToolResult = { tool: "web_search", provider: "anthropic" };
    expect(estimateHostedToolCost(r, "claude-opus-4-8")).toBeUndefined();
  });
});

describe("foldHostedToolCost", () => {
  it("adds hostedToolsCost into the estimate and totalCost", () => {
    const base = { inputCost: 0.1, outputCost: 0.2, totalCost: 0.3, currency: "USD" };
    const out = foldHostedToolCost(base, [{ tool: "web_search", provider: "anthropic", estimatedCost: 0.05 }]);
    expect(out?.hostedToolsCost).toBeCloseTo(0.05, 6);
    expect(out?.totalCost).toBeCloseTo(0.35, 6);
  });
  it("returns the base unchanged when there is no hosted cost", () => {
    const base = { inputCost: 0.1, outputCost: 0.2, totalCost: 0.3, currency: "USD" };
    expect(foldHostedToolCost(base, [])).toBe(base);
  });
});

describe("webSearchResult", () => {
  it("omits empty fields", () => {
    const r = webSearchResult("anthropic", { queries: [], sources: [{ url: "https://a" }], callCount: 2 });
    expect(r.tool).toBe("web_search");
    expect(r.queries).toBeUndefined();
    expect(r.sources).toHaveLength(1);
    expect(r.callCount).toBe(2);
  });
});

describe("applyHostedToolCost", () => {
  it("sets estimatedCost per result and folds into cost", () => {
    const base = { inputCost: 0, outputCost: 0, totalCost: 0, currency: "USD" };
    const { results, cost } = applyHostedToolCost(
      [{ tool: "web_search", provider: "anthropic", callCount: 2 }],
      base,
      "claude-opus-4-8",
    );
    expect(results[0].estimatedCost).toBeCloseTo(0.02, 6);
    expect(cost?.hostedToolsCost).toBeCloseTo(0.02, 6);
  });
});
