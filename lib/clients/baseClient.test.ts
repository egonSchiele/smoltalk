import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { BaseClient } from "./baseClient.js";
import { userMessage, assistantMessage } from "../classes/message/index.js";
import { PromptConfig, PromptResult, Result, StreamChunk } from "../types.js";

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

    const result = await spy.textSync({
      messages: [userMessage("test")],
      responseFormat: schema,
      responseFormatOptions: { strict: true, numRetries: 2 },
    });

    // After exhausting retries, returns the last output as-is
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.output).toBe(badOutput);
    }
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
      expect(result.value.output).toBe(outputWithExtra);
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
