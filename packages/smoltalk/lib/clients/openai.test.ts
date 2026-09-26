import { describe, it, expect } from "vitest";
import { z } from "zod";
import { SmolOpenAi } from "./openai.js";
import { userMessage } from "../classes/message/index.js";
import type { SmolConfig } from "../types.js";
import type { ModelDataBlob } from "../modelData.js";

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

describe("SmolOpenAi maxTokens", () => {
  it("sends maxTokens as max_completion_tokens", () => {
    const c = new ExtrasProvider({
      model: "gpt-4o",
      provider: "openai",
      messages: [],
    });
    const req = c.publicBuild({
      model: "gpt-4o" as any,
      messages: [],
      maxTokens: 123,
    } as SmolConfig);
    expect(req.max_completion_tokens).toBe(123);
    expect(req.max_tokens).toBeUndefined();
  });

  it("omits the token limit when maxTokens is not set", () => {
    const c = new ExtrasProvider({
      model: "gpt-4o",
      provider: "openai",
      messages: [],
    });
    const req = c.publicBuild({
      model: "gpt-4o" as any,
      messages: [],
    } as SmolConfig);
    expect("max_completion_tokens" in req).toBe(false);
    expect("max_tokens" in req).toBe(false);
  });
});

const audioModelData: ModelDataBlob = {
  schemaVersion: 1,
  generatedAt: "test",
  models: [
    {
      type: "text",
      modelName: "audio-test-multi",
      provider: "openai",
      maxInputTokens: 128_000,
      maxOutputTokens: 16_384,
      inputTokenCost: 2,
      outputTokenCost: 10,
      inputAudioTokenCost: 32,
      outputAudioTokenCost: 64,
    },
    {
      type: "text",
      modelName: "audio-test-multi",
      provider: "acme",
      maxInputTokens: 128_000,
      maxOutputTokens: 16_384,
      inputTokenCost: 1,
      outputTokenCost: 1,
      inputAudioTokenCost: 1,
      outputAudioTokenCost: 1,
    },
  ],
  hostedTools: [],
};

class AudioSeamProvider extends SmolOpenAi {
  protected resolveClientOptions() {
    return { apiKey: "k" };
  }
  // Expose protected method for tests
  publicCalc(usage: any, rawResponse?: Response) {
    return (this as any).calculateUsageAndCost(usage, rawResponse);
  }
}

class OverrideCostProvider extends AudioSeamProvider {
  protected resolveCostUsd() {
    return 12.34;
  }
}

describe("SmolOpenAi audio token cost seam", () => {
  it("parses disjoint audio buckets and prices them via the openai-provider registry entry, not acme's", () => {
    const c = new AudioSeamProvider({
      model: "audio-test-multi",
      provider: "openai",
      messages: [],
      modelData: audioModelData,
    });
    const { usage, cost } = c.publicCalc({
      prompt_tokens: 2_000_000,
      completion_tokens: 2_000_000,
      total_tokens: 4_000_000,
      prompt_tokens_details: { audio_tokens: 1_000_000 },
      completion_tokens_details: { audio_tokens: 1_000_000 },
    });
    expect(usage?.inputTokens).toBe(1_000_000);
    expect(usage?.outputTokens).toBe(1_000_000);
    expect(usage?.inputAudioTokens).toBe(1_000_000);
    expect(usage?.outputAudioTokens).toBe(1_000_000);
    expect(cost?.inputCost).toBe(34);
    expect(cost?.outputCost).toBe(74);
    expect(cost?.totalCost).toBe(108);
  });

  it("still lets provider-supplied cost override registry math when audio tokens are present", () => {
    const c = new OverrideCostProvider({
      model: "audio-test-multi",
      provider: "openai",
      messages: [],
      modelData: audioModelData,
    });
    const { cost } = c.publicCalc({
      prompt_tokens: 2_000_000,
      completion_tokens: 2_000_000,
      prompt_tokens_details: { audio_tokens: 1_000_000 },
      completion_tokens_details: { audio_tokens: 1_000_000 },
    });
    expect(cost?.totalCost).toBe(12.34);
  });
});

// Feeds a canned SDK value into the real _textSync / _textStream so the
// logprobs mapping can be tested without a network call. The sync path
// calls `.create(...).withResponse()`; the stream path awaits `.create(...)`
// and iterates it.
class LogprobProvider extends SmolOpenAi {
  protected resolveClientOptions() {
    return { apiKey: "k" };
  }
  publicBuild(config: SmolConfig) {
    return (this as any).buildRequest(config);
  }
}

function logprobProvider(): LogprobProvider {
  return new LogprobProvider({ model: "gpt-4o", provider: "openai", messages: [] });
}

async function textSyncWith(completion: any, config: Partial<SmolConfig>) {
  const provider = logprobProvider();
  (provider as any).client.chat.completions.create = () => ({
    withResponse: async () => ({ data: completion, response: undefined }),
  });
  return provider._textSync({
    model: "gpt-4o",
    provider: "openai",
    messages: [],
    ...config,
  } as SmolConfig);
}

async function lastChunkOfStreamWith(chunks: any[], config: Partial<SmolConfig>) {
  const provider = logprobProvider();
  (provider as any).client.chat.completions.create = async () => {
    async function* gen() {
      for (const chunk of chunks) {
        yield chunk;
      }
    }
    return gen();
  };
  let done: any;
  for await (const chunk of provider._textStream({
    model: "gpt-4o",
    provider: "openai",
    messages: [],
    ...config,
  } as SmolConfig)) {
    if (chunk.type === "done") {
      done = chunk;
    }
  }
  return done;
}

describe("SmolOpenAi logprobs", () => {
  it("asks the chat API for logprobs, with top_logprobs only when alternatives are wanted", () => {
    const c = logprobProvider();
    const base = { model: "gpt-4o", provider: "openai", messages: [] } as SmolConfig;
    expect(c.publicBuild(base)).not.toHaveProperty("logprobs");
    expect(c.publicBuild({ ...base, logprobs: {} })).toMatchObject({ logprobs: true });
    expect(c.publicBuild({ ...base, logprobs: { top: 0 } })).not.toHaveProperty("top_logprobs");
    expect(c.publicBuild({ ...base, logprobs: { top: 3 } })).toMatchObject({
      logprobs: true,
      top_logprobs: 3,
    });
  });

  it("maps a chat response's logprobs onto the result", async () => {
    const completion = {
      choices: [
        {
          message: { content: "Hi!", tool_calls: undefined },
          finish_reason: "stop",
          logprobs: {
            content: [
              {
                token: "Hi",
                bytes: [72, 105],
                logprob: -0.1,
                top_logprobs: [
                  { token: "Hi", bytes: null, logprob: -0.1 },
                  { token: "Hello", bytes: null, logprob: -2.3 },
                ],
              },
              { token: "!", bytes: [33], logprob: -0.5, top_logprobs: [] },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
    };
    const result = await textSyncWith(completion, { logprobs: { top: 2 } });
    if (!result.success) {
      throw new Error(result.error);
    }
    expect(result.value.logprobs).toEqual([
      {
        token: "Hi",
        logprob: -0.1,
        top: [
          { token: "Hi", logprob: -0.1 },
          { token: "Hello", logprob: -2.3 },
        ],
      },
      { token: "!", logprob: -0.5 },
    ]);
  });

  it("collects streamed logprobs onto the done result", async () => {
    const chunks = [
      {
        choices: [
          {
            delta: { content: "Hi" },
            logprobs: { content: [{ token: "Hi", logprob: -0.1, top_logprobs: [] }] },
          },
        ],
      },
      {
        choices: [
          {
            delta: { content: "!" },
            finish_reason: "stop",
            logprobs: { content: [{ token: "!", logprob: -0.5, top_logprobs: [] }] },
          },
        ],
      },
      { choices: [], usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } },
    ];
    const done = await lastChunkOfStreamWith(chunks, { logprobs: {} });
    expect(done.result.logprobs).toEqual([
      { token: "Hi", logprob: -0.1 },
      { token: "!", logprob: -0.5 },
    ]);
  });

  it("leaves logprobs absent when the response has none", async () => {
    const completion = {
      choices: [{ message: { content: "Hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    const result = await textSyncWith(completion, {});
    if (!result.success) {
      throw new Error(result.error);
    }
    expect(result.value).not.toHaveProperty("logprobs");
  });

  // Review Focus 3: a structured-output reply that fails validation retries;
  // the retry's logprobs must reach the final result. textWithRetry must not
  // rebuild the PromptResult in a way that drops them.
  it("keeps the retry's logprobs when a structured-output reply is retried", async () => {
    const invalid = {
      choices: [{ message: { content: "not json" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    const valid = {
      choices: [
        {
          message: { content: '{"answer":"hi"}' },
          finish_reason: "stop",
          logprobs: { content: [{ token: "hi", logprob: -0.2, top_logprobs: [] }] },
        },
      ],
      usage: { prompt_tokens: 3, completion_tokens: 3, total_tokens: 6 },
    };
    const completions = [invalid, valid];
    let call = 0;
    const provider = logprobProvider();
    (provider as any).client.chat.completions.create = () => ({
      withResponse: async () => ({
        data: completions[Math.min(call++, completions.length - 1)],
        response: undefined,
      }),
    });
    const result = await provider.textSync({
      model: "gpt-4o",
      provider: "openai",
      messages: [userMessage("give me json")],
      logprobs: {},
      responseFormat: z.object({ answer: z.string() }),
      responseFormatOptions: { strict: true },
    } as SmolConfig);
    if (!result.success) {
      throw new Error(result.error);
    }
    expect(call).toBe(2); // the first reply failed validation and was retried
    expect(result.value.logprobs).toEqual([{ token: "hi", logprob: -0.2 }]);
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
