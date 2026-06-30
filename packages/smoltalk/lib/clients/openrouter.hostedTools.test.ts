import { describe, it, expect } from "vitest";
import { validateHostedTools } from "../util/hostedTools.js";

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
});
