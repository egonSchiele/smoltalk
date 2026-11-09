import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  decide,
  registerDecisionProvider,
  hasDecisionProvider,
  unregisterDecisionProvider,
  type DecideConfig,
  type DecisionQuestion,
  type DecisionState,
} from "./decide.js";
import { success, failure } from "./types/result.js";

const questions: Record<string, DecisionQuestion> = {
  team: {
    type: "choice",
    instructions: "Which team?",
    criteria: { billing: "refunds", support: "bugs" },
  },
};

const goodReply = {
  answers: {
    team: {
      type: "choice" as const,
      choice: "billing",
      confidence: 0.9,
      probabilities: { billing: 0.9, support: 0.1 },
    },
  },
  usage: { inputTokens: 7, outputTokens: 0 },
};

describe("registerDecisionProvider", () => {
  afterEach(() => {
    unregisterDecisionProvider("fake-decide");
    unregisterDecisionProvider("openrouter");
  });

  it("calls a registered provider with the state, the questions, and the config", async () => {
    let received: { state: DecisionState; questions: unknown; config: DecideConfig } | undefined;
    registerDecisionProvider("fake-decide", async (state, qs, config) => {
      received = { state, questions: qs, config };
      return success({ ...goodReply, model: "fake-1" });
    });
    const r = await decide({ ticket: 1 }, questions, { provider: "fake-decide", model: "fake" });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.value.answers).toEqual(goodReply.answers);
    expect(r.value.usage).toEqual({ inputTokens: 7, outputTokens: 0 });
    expect(r.value.model).toBe("fake-1");
    expect(r.value.cost).toBeUndefined();
    expect(received?.state).toEqual({ ticket: 1 });
    expect(received?.questions).toEqual(questions);
    expect(received?.config.model).toBe("fake");
    expect(received?.config.provider).toBe("fake-decide");
  });

  it("falls back to the requested model name when the provider reports none", async () => {
    registerDecisionProvider("fake-decide", async () => success(goodReply));
    const r = await decide("hi", questions, { provider: "fake-decide", model: "fake" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.value.model).toBe("fake");
  });

  it("passes config.metadata to a registered provider", async () => {
    let seen: unknown;
    registerDecisionProvider("fake-decide", async (state, qs, config) => {
      seen = config.metadata;
      return success(goodReply);
    });
    await decide("hi", questions, {
      provider: "fake-decide",
      model: "fake",
      metadata: { contextSize: 8192 },
    });
    expect(seen).toEqual({ contextSize: 8192 });
  });

  it("checks the questions before calling a registered provider", async () => {
    const fn = vi.fn(async () => success(goodReply));
    registerDecisionProvider("fake-decide", fn);
    const r = await decide("hi", {}, { provider: "fake-decide", model: "fake" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/No questions given/);
    expect(fn).not.toHaveBeenCalled();
  });

  it("checks a registered provider's answers", async () => {
    registerDecisionProvider("fake-decide", async () =>
      success({
        answers: { team: { type: "choice", choice: "sales", confidence: 0.9, probabilities: {} } },
        usage: { inputTokens: 1, outputTokens: 0 },
      }),
    );
    const r = await decide("hi", questions, { provider: "fake-decide", model: "fake" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/answered "sales", which is not one of its options/);
  });

  it("returns a registered provider's failure with its status", async () => {
    registerDecisionProvider("fake-decide", async () => failure("rate limited", { status: 429 }));
    const r = await decide("hi", questions, { provider: "fake-decide", model: "fake" });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toBe("rate limited");
    expect(r.status).toBe(429);
  });

  it("reports and removes a registration, like the embedding registry", () => {
    expect(hasDecisionProvider("fake-decide")).toBe(false);
    registerDecisionProvider("fake-decide", async () => success(goodReply));
    expect(hasDecisionProvider("fake-decide")).toBe(true);
    expect(unregisterDecisionProvider("fake-decide")).toBe(true);
    expect(hasDecisionProvider("fake-decide")).toBe(false);
    expect(unregisterDecisionProvider("fake-decide")).toBe(false);
    expect(hasDecisionProvider("toString")).toBe(false);
  });
});

describe("decide with a built-in provider name", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    globalThis.fetch = vi.fn(async () => {
      throw new Error("no network in tests");
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    globalThis.fetch = originalFetch;
    unregisterDecisionProvider("openrouter");
  });

  it("never calls a registration under a built-in name", async () => {
    const fn = vi.fn(async () => success(goodReply));
    registerDecisionProvider("openrouter", fn);
    const r = await decide("hi", questions, { provider: "openrouter", model: "jev-1.14" });
    expect(fn).not.toHaveBeenCalled();
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/OPENROUTER_API_KEY/);
  });

  it("names the built-in providers and the registry for an unknown provider", async () => {
    const r = await decide("hi", questions, { provider: "acme", model: "x" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toBe(
        'Provider "acme" does not answer decisions. Use one of: typesafe, openrouter, openai, or register one with registerDecisionProvider(name, fn).',
      );
    }
  });

  it("treats a prototype name as an unknown provider and does not throw", async () => {
    const r = await decide("hi", questions, { provider: "toString", model: "x" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/^Provider "toString" does not answer decisions/);
  });

  it("reports an unknown provider before a question problem", async () => {
    const r = await decide("hi", {}, { provider: "acme", model: "x" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/does not answer decisions/);
  });
});
