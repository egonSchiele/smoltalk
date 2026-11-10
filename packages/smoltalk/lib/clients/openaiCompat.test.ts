import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SmolOpenAiCompat } from "./openaiCompat.js";
import { assistantMessage, userMessage } from "../classes/message/index.js";

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

  it("sends maxTokens as max_tokens, which compat servers accept", () => {
    const c = new SmolOpenAiCompat({
      ...base,
      apiKey: { openAiCompat: "k" },
      baseUrl: { openAiCompat: "https://host.test/v1" },
    });
    const req = (c as any).buildRequest({ ...base, maxTokens: 400 });
    expect(req.max_tokens).toBe(400);
    expect(req.max_completion_tokens).toBeUndefined();
  });

  it("other OpenAI-shaped clients ignore openRouter", () => {
    const c = new SmolOpenAiCompat({
      ...base,
      apiKey: { openAiCompat: "k" },
      baseUrl: { openAiCompat: "https://host.test/v1" },
    });
    const req = (c as any).buildRequest({
      ...base,
      openRouter: { provider: { order: ["z-ai"] } },
    });
    expect(req.provider).toBeUndefined();
  });
});

describe("SmolOpenAiCompat reasoning", () => {
  it("reads reasoning_content and sends it back in reasoning_content", async () => {
    const c = new SmolOpenAiCompat({
      ...base,
      apiKey: { openAiCompat: "k" },
      baseUrl: { openAiCompat: "https://host.test/v1" },
    });
    (c as any).client.chat.completions.create = () => ({
      withResponse: async () => ({
        data: {
          choices: [{ message: { content: "", reasoning_content: "think" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        },
        response: undefined,
      }),
    });
    const result = await c._textSync({ ...base });
    if (!result.success) throw new Error(result.error);
    expect(result.value.reasoning).toBe("think");
    expect(result.value.reasoningRecord).toEqual({
      provider: "openai-compat",
      model: "some/model",
      text: "think",
      format: "reasoning_content",
    });
    const request = (c as any).buildRequest({
      ...base,
      messages: [userMessage("hi"), assistantMessage("x", { reasoning: result.value.reasoningRecord })],
    });
    expect(request.messages[1].reasoning_content).toBe("think");
    expect(request.messages[1].reasoning).toBeUndefined();
  });
});
