import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SmolLiteLlm } from "./litellm.js";

const base = {
  model: "openai/gpt-4o",
  provider: "litellm" as const,
  messages: [],
};

describe("SmolLiteLlm", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.LITELLM_API_KEY;
    delete process.env.LITELLM_BASE_URL;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("requires a base URL and key", () => {
    expect(
      () => new SmolLiteLlm({ ...base, apiKey: { liteLlm: "k" } }),
    ).toThrow(/base URL/i);
    expect(
      () =>
        new SmolLiteLlm({
          ...base,
          baseUrl: { liteLlm: "http://localhost:4000" },
        }),
    ).toThrow(/API key/i);
  });

  it("env-var fallbacks satisfy both requirements", () => {
    process.env.LITELLM_API_KEY = "env-k";
    process.env.LITELLM_BASE_URL = "http://localhost:4000";
    const c = new SmolLiteLlm(base);
    expect((c as any).client.baseURL).toContain("4000");
  });

  it("reads cost from the x-litellm-response-cost header", () => {
    const c = new SmolLiteLlm({
      ...base,
      apiKey: { liteLlm: "k" },
      baseUrl: { liteLlm: "http://localhost:4000" },
    });
    const resp = new Response(null, {
      headers: { "x-litellm-response-cost": "0.0021" },
    });
    expect(
      (c as any).calculateUsageAndCost(
        { prompt_tokens: 10, completion_tokens: 5 },
        resp,
      ).cost?.totalCost,
    ).toBe(0.0021);
  });

  it("returns no provider cost when the header is absent (e.g. streaming)", () => {
    const c = new SmolLiteLlm({
      ...base,
      apiKey: { liteLlm: "k" },
      baseUrl: { liteLlm: "http://localhost:4000" },
    });
    const { cost } = (c as any).calculateUsageAndCost({
      prompt_tokens: 10,
      completion_tokens: 5,
    });
    // openai/gpt-4o isn't a known model id in the smoltalk registry → no
    // fallback cost either.
    expect(cost?.totalCost).toBeUndefined();
  });

  it("ignores a non-numeric header value", () => {
    const c = new SmolLiteLlm({
      ...base,
      apiKey: { liteLlm: "k" },
      baseUrl: { liteLlm: "http://localhost:4000" },
    });
    const resp = new Response(null, {
      headers: { "x-litellm-response-cost": "not-a-number" },
    });
    const { cost } = (c as any).calculateUsageAndCost(
      { prompt_tokens: 10, completion_tokens: 5 },
      resp,
    );
    expect(cost?.totalCost).toBeUndefined();
  });
});
