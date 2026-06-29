import { describe, it, expect } from "vitest";
import { translateModelsDevEntry, buildRefreshedBlob } from "../scripts/refresh-from-modelsdev.js";

const opus = {
  id: "claude-opus-4-5",
  name: "Claude Opus 4.5",
  family: "claude-opus",
  reasoning: true,
  knowledge: "2025-03-31",
  release_date: "2025-11-24",
  last_updated: "2025-11-24",
  modalities: { input: ["text", "image", "pdf"], output: ["text"] },
  open_weights: false,
  structured_output: true,
  temperature: true,
  limit: { context: 200000, output: 64000 },
  cost: { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
};

describe("translateModelsDevEntry", () => {
  it("maps a text model into smoltalk shape", () => {
    const m = translateModelsDevEntry("anthropic", opus) as any;
    expect(m.type).toBe("text");
    expect(m.modelName).toBe("claude-opus-4-5");
    expect(m.provider).toBe("anthropic");
    expect(m.maxInputTokens).toBe(200000);
    expect(m.maxOutputTokens).toBe(64000);
    expect(m.inputTokenCost).toBe(5);
    expect(m.outputTokenCost).toBe(25);
    expect(m.cachedInputTokenCost).toBe(0.5);
    expect(m.cacheCreationInputTokenCost).toBe(6.25);
    expect(m.knowledge).toBe("2025-03-31");
    expect(m.family).toBe("claude-opus");
    expect(m.structuredOutput).toBe(true);
  });

  it("maps long-context pricing from context_over_200k", () => {
    const entry = { ...opus, cost: { ...opus.cost, context_over_200k: { input: 10, output: 30 } } };
    const m = translateModelsDevEntry("anthropic", entry) as any;
    expect(m.longContext.thresholdTokens).toBe(200000);
    expect(m.longContext.inputTokenCost).toBe(10);
  });

  it("returns null for an entry with no token limits (non-text)", () => {
    const m = translateModelsDevEntry("openai", { id: "whatever", modalities: { input: ["text"], output: ["image"] } });
    expect(m).toBeNull();
  });
});

describe("buildRefreshedBlob", () => {
  it("merges translated entries over the baseline by provider name", () => {
    const api = { anthropic: { id: "anthropic", models: { "claude-opus-4-8": { id: "claude-opus-4-8", limit: { context: 1000000, output: 128000 }, cost: { input: 42, output: 25 } } } } };
    const blob = buildRefreshedBlob(api, "2026-06-28T00:00:00Z");
    const opus48 = blob.models.find((m) => m.modelName === "claude-opus-4-8") as any;
    expect(opus48.inputTokenCost).toBe(42); // models.dev wins on pricing
    expect(opus48.cachedInputTokenCost).toBe(0.5); // baseline-only field preserved
  });

  it("reuses the baseline provider for a known model (no cross-provider duplicate)", () => {
    // models.dev labels gpt-5-pro as `openai`, but smoltalk serves it via
    // `openai-responses` (Responses-only). The correction must land on the single
    // entry that getModel() (match-by-name) returns — not a shadow `openai` dup.
    const api = { openai: { id: "openai", models: { "gpt-5-pro": { id: "gpt-5-pro", limit: { context: 400000, output: 128000 }, cost: { input: 99, output: 10 } } } } };
    const blob = buildRefreshedBlob(api, "2026-06-28T00:00:00Z");
    const matches = blob.models.filter((m) => m.modelName === "gpt-5-pro");
    expect(matches).toHaveLength(1);
    expect(matches[0].provider).toBe("openai-responses");
    expect(matches[0].inputTokenCost).toBe(99);
  });
});
