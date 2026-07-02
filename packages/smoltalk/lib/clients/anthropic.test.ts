import { describe, it, expect } from "vitest";
import {
  SmolAnthropic,
  applyCacheBreakpoints,
  mergeConsecutiveMessages,
} from "./anthropic.js";
import {
  SystemMessage,
  userMessage,
  assistantMessage,
  ToolMessage,
} from "../classes/message/index.js";
import { z } from "zod";

describe("applyCacheBreakpoints with image content", () => {
  it("marks the last block of a user message ending in an image", () => {
    const out: any = applyCacheBreakpoints({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "IMG" } },
          ],
        },
      ],
    } as any);
    const blocks = out.messages[0].content;
    const last = blocks[blocks.length - 1];
    expect(last.type).toBe("image");
    expect(last.cache_control).toEqual({ type: "ephemeral" });
  });
});

function build(client: SmolAnthropic, config: any) {
  return (client as any).buildRequest(config);
}

describe("mergeConsecutiveMessages", () => {
  it("merges two consecutive user string messages into one", () => {
    const out = mergeConsecutiveMessages([
      { role: "user", content: "first" },
      { role: "user", content: "second" },
    ] as any);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("user");
    expect(out[0].content).toEqual([
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ]);
  });

  it("merges a user message followed by tool_result blocks (both role user)", () => {
    const out = mergeConsecutiveMessages([
      { role: "user", content: "please continue" },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: "42" }],
      },
    ] as any);
    expect(out).toHaveLength(1);
    expect(out[0].content).toEqual([
      { type: "text", text: "please continue" },
      { type: "tool_result", tool_use_id: "t1", content: "42" },
    ]);
  });

  it("merges consecutive tool_result-only user messages (the pre-existing case)", () => {
    const out = mergeConsecutiveMessages([
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: "a" }],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t2", content: "b" }],
      },
    ] as any);
    expect(out).toHaveLength(1);
    expect(out[0].content).toEqual([
      { type: "tool_result", tool_use_id: "t1", content: "a" },
      { type: "tool_result", tool_use_id: "t2", content: "b" },
    ]);
  });

  it("merges consecutive assistant string messages into one", () => {
    const out = mergeConsecutiveMessages([
      { role: "assistant", content: "part one" },
      { role: "assistant", content: "part two" },
    ] as any);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("assistant");
    expect(out[0].content).toEqual([
      { type: "text", text: "part one" },
      { type: "text", text: "part two" },
    ]);
  });

  it("leaves an already-alternating conversation unchanged", () => {
    const input = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "bye" },
    ] as any;
    const out = mergeConsecutiveMessages(input);
    expect(out).toEqual(input);
  });

  it("drops empty-string content instead of emitting an empty text block", () => {
    const out = mergeConsecutiveMessages([
      { role: "user", content: "" },
      { role: "user", content: "real" },
    ] as any);
    expect(out).toHaveLength(1);
    expect(out[0].content).toEqual([{ type: "text", text: "real" }]);
  });

  it("does not mutate the input messages", () => {
    const input = [
      { role: "user", content: "a" },
      { role: "user", content: "b" },
    ] as any;
    const snapshot = JSON.parse(JSON.stringify(input));
    mergeConsecutiveMessages(input);
    expect(input).toEqual(snapshot);
  });

  it("does not throw when a same-role message has non-array, non-string content", () => {
    const out = mergeConsecutiveMessages([
      { role: "assistant", content: null },
      { role: "assistant", content: "recovered" },
    ] as any);
    expect(out).toHaveLength(1);
    expect(out[0].content).toEqual([{ type: "text", text: "recovered" }]);
  });
});

describe("SmolAnthropic.buildRequest merges consecutive same-role messages", () => {
  const client = new SmolAnthropic({
    model: "claude-sonnet-4-6",
    apiKey: { anthropic: "test-key" },
    messages: [],
  });

  it("collapses two consecutive user messages into a single Anthropic turn", () => {
    const { messages } = build(client, {
      model: "claude-sonnet-4-6" as const,
      messages: [
        userMessage("first question"),
        userMessage("actually, also this"),
        assistantMessage("answering both"),
      ],
    });
    const userTurns = messages.filter((m: any) => m.role === "user");
    expect(userTurns).toHaveLength(1);
    const texts = (userTurns[0].content as any[])
      .filter((b) => b.type === "text")
      .map((b) => b.text);
    expect(texts).toEqual(["first question", "actually, also this"]);
  });

  it("merges a trailing tool result into the preceding user message", () => {
    const { messages } = build(client, {
      model: "claude-sonnet-4-6" as const,
      messages: [
        userMessage("use the tool then tell me"),
        new ToolMessage("tool output", {
          tool_call_id: "call_1",
          name: "my_tool",
        }),
      ],
    });
    const userTurns = messages.filter((m: any) => m.role === "user");
    expect(userTurns).toHaveLength(1);
    const types = (userTurns[0].content as any[]).map((b) => b.type);
    expect(types).toContain("text");
    expect(types).toContain("tool_result");
  });
});

describe("SmolAnthropic.buildRequest cache_control", () => {
  const client = new SmolAnthropic({
    model: "claude-sonnet-4-6",
    apiKey: { anthropic: "test-key" },
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
      apiKey: { anthropic: "test-key" },
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
    apiKey: { anthropic: "test-key" },
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
