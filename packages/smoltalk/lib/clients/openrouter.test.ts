import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SmolOpenRouter } from "./openrouter.js";
import { userMessage } from "../classes/message/index.js";

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

  it("injects usage:{include:true} in the request body", () => {
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
    expect(request.usage).toEqual({ include: true });
    // No plugins when web_search is not requested
    expect(request.plugins).toBeUndefined();
  });

  it("injects the web plugin when web_search is requested", () => {
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
    expect(request.usage).toEqual({ include: true });
    expect(request.plugins).toEqual([{ id: "web", max_results: 5 }]);
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
