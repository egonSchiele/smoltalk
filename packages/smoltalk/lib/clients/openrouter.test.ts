import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { SmolOpenRouter } from "./openrouter.js";
import { userMessage } from "../classes/message/index.js";
import type { SmolConfig } from "../types.js";

const baseModel = "z-ai/glm-5.2";

describe("SmolOpenRouter", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("bakes the base URL and reads usage.cost", () => {
    const c = new SmolOpenRouter({
      model: baseModel,
      provider: "openrouter",
      apiKey: { openRouter: "k" },
      messages: [],
    });
    expect((c as any).client.baseURL).toContain("openrouter.ai");
    expect(
      (c as any).calculateUsageAndCost({
        prompt_tokens: 1,
        completion_tokens: 1,
        cost: 0.03,
      }).cost?.totalCost,
    ).toBe(0.03);
    // does NOT pick up estimated_cost
    expect(
      (c as any).calculateUsageAndCost({
        prompt_tokens: 1,
        completion_tokens: 1,
        estimated_cost: 0.09,
      }).cost?.totalCost,
    ).not.toBe(0.09);
  });

  it("base URL override is honored", () => {
    const c = new SmolOpenRouter({
      model: baseModel,
      provider: "openrouter",
      apiKey: { openRouter: "k" },
      baseUrl: { openRouter: "https://proxy.test/v1" },
      messages: [],
    });
    expect((c as any).client.baseURL).toContain("proxy.test");
  });

  it("throws a clear error when the key is missing", () => {
    expect(
      () =>
        new SmolOpenRouter({
          model: baseModel,
          provider: "openrouter",
          messages: [],
        }),
    ).toThrow(/API key/i);
  });

  it("does not inject the deprecated usage:{include:true}", () => {
    const c = new SmolOpenRouter({
      model: baseModel,
      provider: "openrouter",
      apiKey: { openRouter: "k" },
      messages: [userMessage("hi")],
    });
    const request = (c as any).buildRequest({
      model: baseModel,
      messages: [userMessage("hi")],
    });
    expect(request.usage).toBeUndefined();
    // No search tool when web_search is not requested
    expect(request.plugins).toBeUndefined();
    expect(request.tools).toBeUndefined();
  });

  it("adds the web_search server tool, not the web plugin, when web_search is requested", () => {
    const c = new SmolOpenRouter({
      model: baseModel,
      provider: "openrouter",
      apiKey: { openRouter: "k" },
      messages: [userMessage("hi")],
      hostedTools: ["web_search"],
    });
    const request = (c as any).buildRequest({
      model: baseModel,
      messages: [userMessage("hi")],
      hostedTools: ["web_search"],
    });
    // The plugin searched on every request; the server tool lets the model decide.
    expect(request.plugins).toBeUndefined();
    expect(request.tools).toEqual([
      { type: "openrouter:web_search", parameters: { max_results: 5 } },
    ]);
  });

  it("keeps function tools ahead of the web_search server tool", () => {
    const c = new SmolOpenRouter({
      model: baseModel,
      provider: "openrouter",
      apiKey: { openRouter: "k" },
      messages: [userMessage("hi")],
    });
    const request = (c as any).buildRequest({
      model: baseModel,
      messages: [userMessage("hi")],
      hostedTools: ["web_search"],
      tools: [
        {
          name: "lookup",
          description: "Look something up",
          schema: z.object({ query: z.string() }),
        },
      ],
    });
    expect(request.tools).toHaveLength(2);
    expect(request.tools[0].type).toBe("function");
    expect(request.tools[0].function.name).toBe("lookup");
    expect(request.tools[1]).toEqual({
      type: "openrouter:web_search",
      parameters: { max_results: 5 },
    });
  });

  it("reports the search count from usage.server_tool_use", () => {
    const c = new SmolOpenRouter({
      model: baseModel,
      provider: "openrouter",
      apiKey: { openRouter: "k" },
      messages: [],
    });
    const completion = {
      usage: { server_tool_use: { web_search_requests: 2 } },
      choices: [
        {
          message: {
            content: "ok",
            annotations: [
              { type: "url_citation", url_citation: { url: "https://example.com/a" } },
            ],
          },
        },
      ],
    };
    const results = (c as any).parseHostedToolResults(completion, {
      hostedTools: ["web_search"],
    });
    expect(results[0].callCount).toBe(2);
  });

  it("reports searches that cited nothing", () => {
    const c = new SmolOpenRouter({
      model: baseModel,
      provider: "openrouter",
      apiKey: { openRouter: "k" },
      messages: [],
    });
    const results = (c as any).parseHostedToolResults(
      {
        usage: { server_tool_use: { web_search_requests: 1 } },
        choices: [{ message: { content: "ok" } }],
      },
      { hostedTools: ["web_search"] },
    );
    expect(results).toEqual([
      { tool: "web_search", provider: "openrouter", callCount: 1 },
    ]);
  });

  it("parses web_search annotations into a HostedToolResult", () => {
    const c = new SmolOpenRouter({
      model: baseModel,
      provider: "openrouter",
      apiKey: { openRouter: "k" },
      messages: [],
      hostedTools: ["web_search"],
    });
    const completion = {
      choices: [
        {
          message: {
            content: "ok",
            annotations: [
              {
                type: "url_citation",
                url_citation: {
                  url: "https://example.com/a",
                  title: "A",
                  start_index: 0,
                  end_index: 2,
                },
              },
              {
                type: "url_citation",
                url_citation: {
                  url: "https://example.com/b",
                  title: "B",
                  content: "snip",
                },
              },
            ],
          },
        },
      ],
    };
    const results = (c as any).parseHostedToolResults(completion, {
      hostedTools: ["web_search"],
    });
    expect(results).toHaveLength(1);
    expect(results[0].tool).toBe("web_search");
    expect(results[0].provider).toBe("openrouter");
    expect(results[0].sources).toHaveLength(2);
    expect(results[0].sources[0].url).toBe("https://example.com/a");
    expect(results[0].citations[0].startIndex).toBe(0);
    expect(results[0].sources[1].snippet).toBe("snip");
  });

  it("emits no hosted-tool results when annotations are absent", () => {
    const c = new SmolOpenRouter({
      model: baseModel,
      provider: "openrouter",
      apiKey: { openRouter: "k" },
      messages: [],
      hostedTools: ["web_search"],
    });
    const results = (c as any).parseHostedToolResults(
      { choices: [{ message: { content: "ok" } }] },
      { hostedTools: ["web_search"] },
    );
    expect(results).toEqual([]);
  });
});

describe("openRouter.provider", () => {
  function build(config: Record<string, unknown>) {
    const c = new SmolOpenRouter({
      model: baseModel,
      provider: "openrouter",
      apiKey: { openRouter: "k" },
      messages: [],
    });
    return (c as any).buildRequest({
      model: baseModel,
      messages: [userMessage("hi")],
      ...config,
    });
  }

  it("sends provider preferences in OpenRouter's field names", () => {
    const request = build({
      openRouter: {
        provider: {
          order: ["z-ai", "fireworks"],
          allowFallbacks: false,
          requireParameters: true,
          dataCollection: "deny",
          sort: "throughput",
          quantizations: ["fp8"],
        },
      },
    });
    expect(request.provider).toEqual({
      order: ["z-ai", "fireworks"],
      allow_fallbacks: false,
      require_parameters: true,
      data_collection: "deny",
      sort: "throughput",
      quantizations: ["fp8"],
    });
  });

  it("sends no provider field when the option is absent", () => {
    expect(build({}).provider).toBeUndefined();
  });

  it("the openRouter option wins over rawAttributes.provider", () => {
    const request = build({
      rawAttributes: { provider: { order: ["open-inference"] } },
      openRouter: { provider: { ignore: ["open-inference"] } },
    });
    expect(request.provider).toEqual({ ignore: ["open-inference"] });
  });
});

describe("SmolOpenRouter servedBy and reasoning", () => {
  function client(): SmolOpenRouter {
    return new SmolOpenRouter({
      model: baseModel,
      provider: "openrouter",
      apiKey: { openRouter: "k" },
      messages: [],
    });
  }

  const config = { model: baseModel, provider: "openrouter", messages: [] } as SmolConfig;

  async function textSyncWith(completion: any) {
    const c = client();
    (c as any).client.chat.completions.create = () => ({
      withResponse: async () => ({ data: completion, response: undefined }),
    });
    const result = await c._textSync(config);
    if (!result.success) throw new Error(result.error);
    return result.value;
  }

  async function lastChunkOfStreamWith(chunks: any[]) {
    const c = client();
    (c as any).client.chat.completions.create = async () => {
      async function* gen() {
        for (const chunk of chunks) yield chunk;
      }
      return gen();
    };
    let done: any;
    for await (const chunk of c._textStream(config)) {
      if (chunk.type === "done") done = chunk;
    }
    return done;
  }

  it("reads the serving provider and reasoning from a reply", async () => {
    const result = await textSyncWith({
      provider: "OpenInference",
      choices: [
        {
          message: { content: "", reasoning: "Let me search", tool_calls: undefined },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 },
    });
    expect(result.servedBy).toBe("OpenInference");
    expect(result.reasoning).toBe("Let me search");
    expect(result.output).toBe("");
    expect(result.toolCalls).toEqual([]);
  });

  it("keeps reasoning on a streamed reply with no text", async () => {
    const done = await lastChunkOfStreamWith([
      { provider: "OpenInference", choices: [{ delta: { reasoning: "Let me " } }] },
      {
        provider: "OpenInference",
        choices: [{ delta: { reasoning: "search" }, finish_reason: "stop" }],
      },
      {
        provider: "OpenInference",
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 },
      },
    ]);
    expect(done.result.servedBy).toBe("OpenInference");
    expect(done.result.reasoning).toBe("Let me search");
    expect(done.result.output).toBeNull();
    expect(done.result.toolCalls).toEqual([]);
  });

  it("leaves both fields off when OpenRouter sends neither", async () => {
    const result = await textSyncWith({
      choices: [{ message: { content: "Hi", tool_calls: undefined }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    expect("servedBy" in result).toBe(false);
    expect("reasoning" in result).toBe(false);
  });
});
