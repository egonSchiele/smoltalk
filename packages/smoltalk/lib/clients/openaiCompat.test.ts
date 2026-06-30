import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SmolOpenAiCompat } from "./openaiCompat.js";

const base = {
  model: "some/model",
  provider: "openai-compat" as const,
  messages: [],
};

describe("SmolOpenAiCompat", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.OPENAI_COMPAT_API_KEY;
    delete process.env.OPENAI_COMPAT_BASE_URL;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses the supplied baseURL and key", () => {
    const c = new SmolOpenAiCompat({
      ...base,
      apiKey: { openAiCompat: "k" },
      baseUrl: { openAiCompat: "https://host.test/v1" },
    });
    expect((c as any).client.baseURL).toContain("host.test");
  });

  it("throws when base URL is missing", () => {
    expect(
      () =>
        new SmolOpenAiCompat({
          ...base,
          apiKey: { openAiCompat: "k" },
        }),
    ).toThrow(/base URL/i);
  });

  it("throws when key is missing", () => {
    expect(
      () =>
        new SmolOpenAiCompat({
          ...base,
          baseUrl: { openAiCompat: "https://host.test/v1" },
        }),
    ).toThrow(/API key/i);
  });

  it("env vars provide both key and URL", () => {
    process.env.OPENAI_COMPAT_API_KEY = "env-k";
    process.env.OPENAI_COMPAT_BASE_URL = "https://env.host/v1";
    const c = new SmolOpenAiCompat(base);
    expect((c as any).client.baseURL).toContain("env.host");
  });

  it("reads cost from usage.cost, usage.estimated_cost, or usage.cost_usd", () => {
    const c = new SmolOpenAiCompat({
      ...base,
      apiKey: { openAiCompat: "k" },
      baseUrl: { openAiCompat: "https://host.test/v1" },
    });
    expect(
      (c as any).calculateUsageAndCost({
        prompt_tokens: 1,
        completion_tokens: 1,
        cost: 0.01,
      }).cost?.totalCost,
    ).toBe(0.01);
    expect(
      (c as any).calculateUsageAndCost({
        prompt_tokens: 1,
        completion_tokens: 1,
        estimated_cost: 0.02,
      }).cost?.totalCost,
    ).toBe(0.02);
    expect(
      (c as any).calculateUsageAndCost({
        prompt_tokens: 1,
        completion_tokens: 1,
        cost_usd: 0.03,
      }).cost?.totalCost,
    ).toBe(0.03);
  });
});
