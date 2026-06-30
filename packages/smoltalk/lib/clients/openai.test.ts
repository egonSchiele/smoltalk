import { describe, it, expect } from "vitest";
import { SmolOpenAi } from "./openai.js";
import type { SmolConfig } from "../types.js";

class FakeProvider extends SmolOpenAi {
  protected resolveClientOptions() {
    return { apiKey: "k", baseURL: "https://example.test/v1" };
  }
  protected resolveCostUsd(usage: any, rawResponse?: Response) {
    if (typeof usage?.cost === "number") return usage.cost;
    const header = rawResponse?.headers?.get?.("x-cost");
    if (header) {
      const n = Number(header);
      return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
  }
  // Expose protected method for tests
  publicCalc(usage: any, rawResponse?: Response) {
    return (this as any).calculateUsageAndCost(usage, rawResponse);
  }
}

class ExtrasProvider extends SmolOpenAi {
  protected resolveClientOptions() {
    return { apiKey: "k" };
  }
  protected buildRequestExtras() {
    return { usage: { include: true }, custom_flag: 42 };
  }
  publicBuild(config: SmolConfig) {
    return (this as any).buildRequest(config);
  }
}

describe("SmolOpenAi seams", () => {
  it("uses resolveClientOptions for baseURL", () => {
    const c = new FakeProvider({
      model: "gpt-4o",
      provider: "openai",
      messages: [],
    });
    expect((c as any).client.baseURL).toContain("example.test");
  });

  it("prefers resolveCostUsd over the registry cost", () => {
    const c = new FakeProvider({
      model: "gpt-4o",
      provider: "openai",
      messages: [],
    });
    const { usage, cost } = c.publicCalc({
      prompt_tokens: 100,
      completion_tokens: 50,
      cost: 0.5,
    });
    expect(cost?.totalCost).toBe(0.5);
    expect(cost?.currency).toBe("USD");
    expect(usage?.inputTokens).toBe(100);
    expect(usage?.outputTokens).toBe(50);
  });

  it("reads provider cost from response headers when supplied", () => {
    const c = new FakeProvider({
      model: "gpt-4o",
      provider: "openai",
      messages: [],
    });
    const resp = new Response(null, { headers: { "x-cost": "0.0021" } });
    const { cost } = c.publicCalc(
      { prompt_tokens: 10, completion_tokens: 5 },
      resp,
    );
    expect(cost?.totalCost).toBe(0.0021);
  });

  it("falls back to registry cost when resolveCostUsd returns undefined", () => {
    const c = new FakeProvider({
      model: "gpt-4o",
      provider: "openai",
      messages: [],
    });
    const { cost } = c.publicCalc({
      prompt_tokens: 100,
      completion_tokens: 50,
    });
    // gpt-4o pricing in the registry → cost should be > 0
    expect(cost?.totalCost).toBeGreaterThan(0);
  });

  it("buildRequestExtras is merged into outgoing requests", () => {
    const c = new ExtrasProvider({
      model: "gpt-4o",
      provider: "openai",
      messages: [],
    });
    const req = c.publicBuild({
      model: "gpt-4o" as any,
      messages: [],
    } as SmolConfig);
    expect(req.usage).toEqual({ include: true });
    expect(req.custom_flag).toBe(42);
  });
});

describe("SmolOpenAi default constructor", () => {
  it("throws when no key is provided and no env var is set", () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      expect(
        () =>
          new SmolOpenAi({
            model: "gpt-4o",
            provider: "openai",
            messages: [],
          }),
      ).toThrow(/OpenAI API key/);
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    }
  });

  it("accepts config.apiKey.openAi", () => {
    expect(
      () =>
        new SmolOpenAi({
          model: "gpt-4o",
          provider: "openai",
          messages: [],
          apiKey: { openAi: "sk-test" },
        }),
    ).not.toThrow();
  });
});
