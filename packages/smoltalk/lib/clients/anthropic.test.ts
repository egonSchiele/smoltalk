import { describe, it, expect } from "vitest";
import { SmolAnthropic } from "./anthropic.js";
import {
  SystemMessage,
  userMessage,
  assistantMessage,
} from "../classes/message/index.js";
import { z } from "zod";

function build(client: SmolAnthropic, config: any) {
  return (client as any).buildRequest(config);
}

describe("SmolAnthropic.buildRequest cache_control", () => {
  const client = new SmolAnthropic({
    model: "claude-sonnet-4-6",
    anthropicApiKey: "test-key",
    messages: [],
  });

  it("marks the last user message with cache_control by default", () => {
    const config = {
      model: "claude-sonnet-4-6" as const,
      messages: [
        userMessage("hello"),
        assistantMessage("hi"),
        userMessage("how are you?"),
      ],
    };
    const { messages } = build(client, config);
    const lastUser = messages[messages.length - 1];
    expect(lastUser.role).toBe("user");
    const content = lastUser.content;
    expect(Array.isArray(content)).toBe(true);
    const lastBlock = content[content.length - 1];
    expect(lastBlock.cache_control).toEqual({ type: "ephemeral" });
  });

  it("marks the system block with cache_control and converts it to array form", () => {
    const config = {
      model: "claude-sonnet-4-6" as const,
      messages: [
        new SystemMessage("you are a helpful assistant"),
        userMessage("hi"),
      ],
    };
    const { system } = build(client, config);
    expect(Array.isArray(system)).toBe(true);
    expect(system[system.length - 1].cache_control).toEqual({
      type: "ephemeral",
    });
  });

  it("marks the last tool with cache_control when tools are provided", () => {
    const config = {
      model: "claude-sonnet-4-6" as const,
      messages: [userMessage("call a tool")],
      tools: [
        { name: "tool_a", schema: z.object({ x: z.string() }) },
        { name: "tool_b", schema: z.object({ y: z.string() }) },
      ],
    };
    const { tools } = build(client, config);
    expect(tools).toHaveLength(2);
    expect(tools[1].cache_control).toEqual({ type: "ephemeral" });
    expect(tools[0].cache_control).toBeUndefined();
  });

  it("does NOT add cache_control when caching is disabled", () => {
    const config = {
      model: "claude-sonnet-4-6" as const,
      messages: [new SystemMessage("sys"), userMessage("hi")],
      tools: [{ name: "t", schema: z.object({ x: z.string() }) }],
      caching: { enabled: false },
    };
    const { system, messages, tools } = build(client, config);
    expect(typeof system).toBe("string");
    const lastUser = messages[messages.length - 1];
    if (Array.isArray(lastUser.content)) {
      const lastBlock = lastUser.content[lastUser.content.length - 1];
      expect(lastBlock.cache_control).toBeUndefined();
    }
    expect(tools[0].cache_control).toBeUndefined();
  });
});

describe("SmolAnthropic.buildRequest thinking normalization", () => {
  function clientFor(model: string) {
    return new SmolAnthropic({
      model: model as any,
      anthropicApiKey: "test-key",
      messages: [],
    });
  }

  it("sends adaptive thinking (no budget_tokens) for Opus 4.7", () => {
    const client = clientFor("claude-opus-4-7");
    const { thinking, outputConfig } = build(client, {
      messages: [userMessage("hi")],
      thinking: { enabled: true, budgetTokens: 8000 },
    });
    expect(thinking).toEqual({ type: "adaptive" });
    expect(outputConfig).toBeUndefined();
  });

  it("maps reasoningEffort to output_config.effort for adaptive models", () => {
    const client = clientFor("claude-opus-4-8");
    const { thinking, outputConfig } = build(client, {
      messages: [userMessage("hi")],
      reasoningEffort: "high",
    });
    expect(thinking).toEqual({ type: "adaptive" });
    expect(outputConfig).toEqual({ effort: "high" });
  });

  it("keeps budget_tokens thinking for Haiku 4.5", () => {
    const client = clientFor("claude-haiku-4-5-20251001");
    const { thinking, outputConfig } = build(client, {
      messages: [userMessage("hi")],
      thinking: { enabled: true, budgetTokens: 8000 },
    });
    expect(thinking).toEqual({ type: "enabled", budget_tokens: 8000 });
    expect(outputConfig).toBeUndefined();
  });

  it("maps reasoningEffort to a budget for budget-style models", () => {
    const client = clientFor("claude-haiku-4-5-20251001");
    const { thinking } = build(client, {
      messages: [userMessage("hi")],
      reasoningEffort: "low",
    });
    expect(thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
  });

  it("omits thinking entirely when neither thinking nor effort is set", () => {
    const client = clientFor("claude-opus-4-8");
    const { thinking, outputConfig } = build(client, {
      messages: [userMessage("hi")],
    });
    expect(thinking).toBeUndefined();
    expect(outputConfig).toBeUndefined();
  });

  it("defaults unknown models to adaptive thinking", () => {
    const client = clientFor("claude-opus-9-preview");
    const { thinking } = build(client, {
      messages: [userMessage("hi")],
      thinking: { enabled: true },
    });
    expect(thinking).toEqual({ type: "adaptive" });
  });
});

describe("SmolAnthropic.calculateUsageAndCost", () => {
  const client = new SmolAnthropic({
    model: "claude-sonnet-4-6",
    anthropicApiKey: "test-key",
    messages: [],
  });

  it("exposes input/cache_read/cache_creation as disjoint buckets", () => {
    const result = (client as any).calculateUsageAndCost({
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 200,
      cache_creation_input_tokens: 50,
    });
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(50);
    expect(result.usage.cachedInputTokens).toBe(200);
    expect(result.usage.cacheCreationInputTokens).toBe(50);
    expect(result.usage.totalTokens).toBe(400);
  });

  it("works when no cache fields are present", () => {
    const result = (client as any).calculateUsageAndCost({
      input_tokens: 100,
      output_tokens: 50,
    });
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.cachedInputTokens).toBeUndefined();
    expect(result.usage.cacheCreationInputTokens).toBeUndefined();
    expect(result.usage.totalTokens).toBe(150);
  });
});
