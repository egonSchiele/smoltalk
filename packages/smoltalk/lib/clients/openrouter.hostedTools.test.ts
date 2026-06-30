import { describe, it, expect } from "vitest";
import { validateHostedTools } from "../util/hostedTools.js";
import { hostedTools } from "../models.js";

describe("openrouter hosted tools", () => {
  it("validates web_search for an openrouter-provided model", () => {
    // Model id isn't in the smoltalk text-model registry, but the explicit
    // provider override is authoritative.
    expect(
      validateHostedTools(["web_search"], "openai/gpt-4o-mini", "openrouter"),
    ).toBeNull();
  });

  it("rejects unimplemented hosted tools", () => {
    const err = validateHostedTools(
      ["maps_grounding"],
      "openai/gpt-4o-mini",
      "openrouter",
    );
    expect(err).toMatch(/maps_grounding/);
  });

  it("prices web_search per call (5 results @ $4/1k = $0.02/call)", () => {
    // Catalog amount is per call (estimateHostedToolCost multiplies callCount
    // by this), so it must equal the cost of one call at the injected
    // max_results=5, not the per-result rate.
    const tool = hostedTools.find(
      (t) => t.provider === "openrouter" && t.name === "web_search",
    );
    expect(tool?.pricing).toEqual(
      expect.objectContaining({ unit: "per_call", amount: 0.02 }),
    );
  });
});
