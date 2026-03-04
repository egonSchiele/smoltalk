import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { BaseClient } from "./baseClient.js";
import { userMessage, assistantMessage, AssistantMessage } from "../classes/message/index.js";
import { PromptConfig, PromptResult, Result, StreamChunk } from "../types.js";
import { SmolStructuredOutputError } from "../smolError.js";

class TestClient extends BaseClient {
  async _textSync(config: PromptConfig) {
    return {
      success: true as const,
      value: { output: "hello", toolCalls: [], model: this.config.model },
    };
  }
}

class SpyClient extends BaseClient {
  calls: PromptConfig[] = [];
  responses: Result<PromptResult>[];
  callIndex = 0;

  constructor(responses: Result<PromptResult>[]) {
    super({ model: "gpt-4o", openAiApiKey: "test" });
    this.responses = responses;
  }

  async _textSync(config: PromptConfig) {
    this.calls.push(config);
    return this.responses[this.callIndex++] ?? this.responses[this.responses.length - 1];
  }
}

function makeMessages(count: number) {
  return Array.from({ length: count }, (_, i) =>
    i % 2 === 0 ? userMessage(`msg ${i}`) : assistantMessage(`msg ${i}`),
  );
}

describe("maxMessages", () => {
  const client = new TestClient({ model: "gpt-4o", openAiApiKey: "test" });

  it("textSync returns failure when messages exceed maxMessages", async () => {
    const result = await client.textSync({
      messages: makeMessages(5),
      maxMessages: 3,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Message limit exceeded");
      expect(result.error).toContain("5");
      expect(result.error).toContain("3");
    }
  });

  it("textSync succeeds when messages are within limit", async () => {
    const result = await client.textSync({
      messages: makeMessages(3),
      maxMessages: 3,
    });
    expect(result.success).toBe(true);
  });

  it("textSync succeeds when maxMessages is not set", async () => {
    const result = await client.textSync({
      messages: makeMessages(100),
    });
    expect(result.success).toBe(true);
  });

  it("textStream yields error when messages exceed maxMessages", async () => {
    const chunks: StreamChunk[] = [];
    for await (const chunk of client.textStream({
      messages: makeMessages(5),
      maxMessages: 3,
    })) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe("error");
  });

  it("textStream succeeds when messages are within limit", async () => {
    const chunks: StreamChunk[] = [];
    for await (const chunk of client.textStream({
      messages: makeMessages(3),
      maxMessages: 3,
    })) {
      chunks.push(chunk);
    }
    const doneChunk = chunks.find((c) => c.type === "done");
    expect(doneChunk).toBeDefined();
  });
});

describe("textWithRetry - validation error feedback", () => {
  const schema = z.object({ name: z.string(), age: z.number().min(0) });

  it("includes validation error in retry messages", async () => {
    const badOutput = JSON.stringify({ name: "Alice", age: -1 });
    const goodOutput = JSON.stringify({ name: "Alice", age: 25 });

    const spy = new SpyClient([
      { success: true, value: { output: badOutput, toolCalls: [], model: "gpt-4o" } },
      { success: true, value: { output: goodOutput, toolCalls: [], model: "gpt-4o" } },
    ]);

    const result = await spy.textSync({
      messages: [userMessage("test")],
      responseFormat: schema,
      responseFormatOptions: { strict: true, numRetries: 2 },
    });

    expect(result.success).toBe(true);
    expect(spy.calls).toHaveLength(2);

    // The retry call should include the failed assistant message and a user message with validation error
    const retryMessages = spy.calls[1].messages;
    const lastAssistant = retryMessages[retryMessages.length - 2];
    const lastUser = retryMessages[retryMessages.length - 1];

    expect(lastAssistant.role).toBe("assistant");
    expect(lastAssistant.content).toBe(badOutput);
    expect(lastUser.role).toBe("user");
    expect(lastUser.content).toContain("failed validation");
  });

  it("returns last output when retries are exhausted", async () => {
    const badOutput = JSON.stringify({ name: "Alice", age: -1 });

    const spy = new SpyClient([
      { success: true, value: { output: badOutput, toolCalls: [], model: "gpt-4o" } },
      { success: true, value: { output: badOutput, toolCalls: [], model: "gpt-4o" } },
      { success: true, value: { output: badOutput, toolCalls: [], model: "gpt-4o" } },
    ]);

    await expect(
      spy.textSync({
        messages: [userMessage("test")],
        responseFormat: schema,
        responseFormatOptions: { strict: true, numRetries: 2 },
      }),
    ).rejects.toThrow(SmolStructuredOutputError);

    // 1 initial + 2 retries = 3 calls
    expect(spy.calls).toHaveLength(3);
  });
});

describe("textWithRetry - allowExtraKeys", () => {
  const schema = z.object({ name: z.string() }).strict();

  it("rejects extra keys by default", async () => {
    const outputWithExtra = JSON.stringify({ name: "Alice", extra: "field" });
    const goodOutput = JSON.stringify({ name: "Alice" });

    const spy = new SpyClient([
      { success: true, value: { output: outputWithExtra, toolCalls: [], model: "gpt-4o" } },
      { success: true, value: { output: goodOutput, toolCalls: [], model: "gpt-4o" } },
    ]);

    const result = await spy.textSync({
      messages: [userMessage("test")],
      responseFormat: schema,
      responseFormatOptions: { strict: true, numRetries: 2 },
    });

    expect(result.success).toBe(true);
    // Should have retried because extra keys are not allowed by default
    expect(spy.calls).toHaveLength(2);
  });

  it("allows extra keys when allowExtraKeys is true", async () => {
    const outputWithExtra = JSON.stringify({ name: "Alice", extra: "field" });

    const spy = new SpyClient([
      { success: true, value: { output: outputWithExtra, toolCalls: [], model: "gpt-4o" } },
    ]);

    const result = await spy.textSync({
      messages: [userMessage("test")],
      responseFormat: schema,
      responseFormatOptions: { strict: true, numRetries: 2, allowExtraKeys: true },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // extractResponse returns the parsed object (with extra keys present), not the original string
      expect(result.value.output).toEqual({ name: "Alice", extra: "field" });
    }
    // Should NOT retry — extra keys are allowed
    expect(spy.calls).toHaveLength(1);
  });

  it("still rejects real validation errors even with allowExtraKeys", async () => {
    const badOutput = JSON.stringify({ name: 123, extra: "field" });
    const goodOutput = JSON.stringify({ name: "Alice" });

    const spy = new SpyClient([
      { success: true, value: { output: badOutput, toolCalls: [], model: "gpt-4o" } },
      { success: true, value: { output: goodOutput, toolCalls: [], model: "gpt-4o" } },
    ]);

    const result = await spy.textSync({
      messages: [userMessage("test")],
      responseFormat: schema,
      responseFormatOptions: { strict: true, numRetries: 2, allowExtraKeys: true },
    });

    expect(result.success).toBe(true);
    // Should retry because there's a real type error (name should be string, got number)
    expect(spy.calls).toHaveLength(2);
  });
});

describe("extractResponse", () => {
  const client = new TestClient({ model: "gpt-4o", openAiApiKey: "test" });
  const schema = z.object({ result: z.number() });
  const config = { messages: [] };

  it("returns data directly when the value matches the schema", () => {
    const result = client.extractResponse(config, { result: 42 }, schema);
    expect(result).toEqual({ result: 42 });
  });

  it("parses a JSON string and validates it", () => {
    const result = client.extractResponse(config, '{"result": 42}', schema);
    expect(result).toEqual({ result: 42 });
  });

  it("strips markdown code fences before parsing a JSON string", () => {
    const fenced = "```json\n{\"result\": 42}\n```";
    const result = client.extractResponse(config, fenced, schema);
    expect(result).toEqual({ result: 42 });
  });

  it("returns an unparseable string as-is", () => {
    const result = client.extractResponse(config, "not json at all", schema);
    expect(result).toBe("not json at all");
  });

  it("returns null as-is", () => {
    const result = client.extractResponse(config, null, schema);
    expect(result).toBeNull();
  });

  it("returns a non-object primitive as-is", () => {
    const result = client.extractResponse(config, 99, schema);
    expect(result).toBe(99);
  });

  it("unwraps a single-element array", () => {
    const result = client.extractResponse(config, [{ result: 42 }], schema);
    expect(result).toEqual({ result: 42 });
  });

  it("returns the first matching element of a multi-element array", () => {
    const result = client.extractResponse(config, [{ result: 1 }, { result: 2 }], schema);
    expect(result).toEqual({ result: 1 });
  });

  it("skips non-matching elements and finds the first match in a mixed array", () => {
    const result = client.extractResponse(config, ["not an object", { result: 7 }], schema);
    expect(result).toEqual({ result: 7 });
  });

  it("finds a matching value via shallow search when no wrap key is present", () => {
    const result = client.extractResponse(config, { nested: { result: 42 } }, schema);
    expect(result).toEqual({ result: 42 });
  });

  it("throws when no extraction strategy succeeds", () => {
    expect(() =>
      client.extractResponse(config, { bad: "data" }, schema),
    ).toThrow();
  });

  it("allows extra keys when allowExtraKeys is true and the only errors are unrecognized keys", () => {
    const strictSchema = z.object({ result: z.number() }).strict();
    const configWithAllowExtra = {
      messages: [],
      responseFormatOptions: { allowExtraKeys: true },
    };
    // With a strict schema and allowExtraKeys, extra keys are tolerated and the original
    // object (with extra keys present) is returned rather than throwing or retrying.
    const result = client.extractResponse(
      configWithAllowExtra,
      { result: 42, extra: "ignored" },
      strictSchema,
    );
    expect(result).toEqual({ result: 42, extra: "ignored" });
  });

  it("still throws on real type errors even when allowExtraKeys is true", () => {
    const strictSchema = z.object({ result: z.number() }).strict();
    const configWithAllowExtra = {
      messages: [],
      responseFormatOptions: { allowExtraKeys: true },
    };
    expect(() =>
      client.extractResponse(
        configWithAllowExtra,
        { result: "not-a-number", extra: "ignored" },
        strictSchema,
      ),
    ).toThrow();
  });
});

describe("applyBudget", () => {
  const client = new TestClient({ model: "gpt-4o", openAiApiKey: "test" });

  it("returns config unchanged when no budget is set", () => {
    const config: PromptConfig = { messages: [userMessage("hi")] };
    const result = client.applyBudget(config);
    expect(result.failure).toBeUndefined();
    expect(result.config).toBe(config);
  });

  it("returns failure when request budget is exhausted", () => {
    const messages = [
      userMessage("q1"),
      assistantMessage("a1"),
      userMessage("q2"),
      assistantMessage("a2"),
    ];
    const result = client.applyBudget({
      messages,
      budget: { requestBudget: 2 },
    });
    expect(result.failure).toBeDefined();
    expect(result.failure!.success).toBe(false);
    if (!result.failure!.success) {
      expect(result.failure!.error).toContain("Request budget exhausted");
    }
  });

  it("allows requests when under budget", () => {
    const messages = [
      userMessage("q1"),
      assistantMessage("a1"),
    ];
    const result = client.applyBudget({
      messages,
      budget: { requestBudget: 2 },
    });
    expect(result.failure).toBeUndefined();
  });

  it("uses explicit requestsUsed override", () => {
    const result = client.applyBudget({
      messages: [userMessage("q1")],
      budget: { requestBudget: 3, requestsUsed: 3 },
    });
    expect(result.failure).toBeDefined();
    if (result.failure && !result.failure.success) {
      expect(result.failure.error).toContain("Request budget exhausted");
    }
  });

  it("sets maxTokens from token budget minus used", () => {
    const messages = [
      userMessage("q1"),
      assistantMessage("a1", { usage: { inputTokens: 10, outputTokens: 200 } }),
      userMessage("q2"),
      assistantMessage("a2", { usage: { inputTokens: 10, outputTokens: 300 } }),
    ];
    const result = client.applyBudget({
      messages,
      budget: { tokenBudget: 1000 },
    });
    expect(result.failure).toBeUndefined();
    // 1000 - 200 - 300 = 500
    expect(result.config.maxTokens).toBe(500);
  });

  it("caps maxTokens to the minimum of existing and budget remaining", () => {
    const messages = [
      userMessage("q1"),
      assistantMessage("a1", { usage: { inputTokens: 10, outputTokens: 100 } }),
    ];
    const result = client.applyBudget({
      messages,
      maxTokens: 200,
      budget: { tokenBudget: 1000 },
    });
    expect(result.failure).toBeUndefined();
    // min(200, 900) = 200
    expect(result.config.maxTokens).toBe(200);
  });

  it("returns failure when token budget is exhausted", () => {
    const result = client.applyBudget({
      messages: [userMessage("q1")],
      budget: { tokenBudget: 100, tokensUsed: 100 },
    });
    expect(result.failure).toBeDefined();
    if (result.failure && !result.failure.success) {
      expect(result.failure.error).toContain("Token budget exhausted");
    }
  });

  it("returns failure when cost budget is exhausted", () => {
    const result = client.applyBudget({
      messages: [userMessage("q1")],
      budget: { costBudget: 0.01, costUsed: 0.01 },
    });
    expect(result.failure).toBeDefined();
    if (result.failure && !result.failure.success) {
      expect(result.failure.error).toContain("Cost budget exhausted");
    }
  });

  it("converts cost budget to maxTokens using model pricing", () => {
    // gpt-4o has outputTokenCost: 10 (per 1M tokens)
    // $0.01 remaining => floor((0.01 / 10) * 1_000_000) = 1000 tokens
    const result = client.applyBudget({
      messages: [userMessage("q1")],
      budget: { costBudget: 0.01 },
    });
    expect(result.failure).toBeUndefined();
    expect(result.config.maxTokens).toBe(1000);
  });

  it("auto-computes costUsed from assistant message cost data", () => {
    const messages = [
      userMessage("q1"),
      assistantMessage("a1", { cost: { inputCost: 0.001, outputCost: 0.004, totalCost: 0.005, currency: "USD" } }),
    ];
    // costBudget=0.01, costUsed auto=0.005, remaining=0.005
    // remainingTokens = floor((0.005 / 10) * 1_000_000) = 500
    const result = client.applyBudget({
      messages,
      budget: { costBudget: 0.01 },
    });
    expect(result.failure).toBeUndefined();
    expect(result.config.maxTokens).toBe(500);
  });

  it("applies both token and cost budgets, taking the minimum maxTokens", () => {
    // tokenBudget: remaining = 2000 - 0 = 2000
    // costBudget: remaining $0.01 => 1000 tokens
    // min(2000, 1000) = 1000
    const result = client.applyBudget({
      messages: [userMessage("q1")],
      budget: { tokenBudget: 2000, costBudget: 0.01 },
    });
    expect(result.failure).toBeUndefined();
    expect(result.config.maxTokens).toBe(1000);
  });

  it("wires budget into textSync - returns failure for exhausted budget", async () => {
    const result = await client.textSync({
      messages: [userMessage("q1")],
      budget: { requestBudget: 0 },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Request budget exhausted");
    }
  });

  it("wires budget into textStream - yields error for exhausted budget", async () => {
    const chunks: StreamChunk[] = [];
    for await (const chunk of client.textStream({
      messages: [userMessage("q1")],
      budget: { requestBudget: 0 },
    })) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe("error");
    if (chunks[0].type === "error") {
      expect(chunks[0].error).toContain("Request budget exhausted");
    }
  });
});
