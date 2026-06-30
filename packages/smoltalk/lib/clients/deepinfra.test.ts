import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SmolDeepInfra } from "./deepinfra.js";

describe("SmolDeepInfra", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.DEEPINFRA_API_KEY;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("bakes the base URL and reads usage.estimated_cost", () => {
    const c = new SmolDeepInfra({
      model: "zai-org/GLM-5.2",
      provider: "deepinfra",
      apiKey: { deepInfra: "k" },
      messages: [],
    });
    expect((c as any).client.baseURL).toContain("deepinfra.com");
    expect(
      (c as any).calculateUsageAndCost({
        prompt_tokens: 1,
        completion_tokens: 1,
        estimated_cost: 0.04,
      }).cost?.totalCost,
    ).toBe(0.04);
    // does NOT pick up `cost` (that's OpenRouter's field)
    expect(
      (c as any).calculateUsageAndCost({
        prompt_tokens: 1,
        completion_tokens: 1,
        cost: 0.09,
      }).cost?.totalCost,
    ).not.toBe(0.09);
  });

  it("base URL override is honored", () => {
    const c = new SmolDeepInfra({
      model: "zai-org/GLM-5.2",
      provider: "deepinfra",
      apiKey: { deepInfra: "k" },
      baseUrl: { deepInfra: "https://proxy.test/v1" },
      messages: [],
    });
    expect((c as any).client.baseURL).toContain("proxy.test");
  });

  it("throws a clear error when the key is missing", () => {
    expect(
      () =>
        new SmolDeepInfra({
          model: "zai-org/GLM-5.2",
          provider: "deepinfra",
          messages: [],
        }),
    ).toThrow(/API key/i);
  });

  it("env var fallback works", () => {
    process.env.DEEPINFRA_API_KEY = "env-key";
    expect(
      () =>
        new SmolDeepInfra({
          model: "zai-org/GLM-5.2",
          provider: "deepinfra",
          messages: [],
        }),
    ).not.toThrow();
  });
});
