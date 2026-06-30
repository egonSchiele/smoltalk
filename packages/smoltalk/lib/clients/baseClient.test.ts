import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { BaseClient } from "./baseClient.js";
import { userMessage, assistantMessage, AssistantMessage, imagePart } from "../classes/message/index.js";
import { SmolConfig, PromptResult, Result, StreamChunk } from "../types.js";
import { SmolStructuredOutputError } from "../smolError.js";

class TestClient extends BaseClient {
  async _textSync(config: SmolConfig) {
    return {
      success: true as const,
      value: { output: "hello", toolCalls: [], model: this.config.model },
    };
  }
}

class SpyClient extends BaseClient {
  calls: SmolConfig[] = [];
  responses: Result<PromptResult>[];
  callIndex = 0;

  constructor(responses: Result<PromptResult>[]) {
    super({ model: "gpt-4o", apiKey: { openAi: "test" } });
    this.responses = responses;
  }

  async _textSync(config: SmolConfig) {
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
  const client = new TestClient({ model: "gpt-4o", apiKey: { openAi: "test" } });

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
  const client = new TestClient({ model: "gpt-4o", apiKey: { openAi: "test" } });
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

class StubAttachmentClient extends BaseClient {
  public seen: any;
  async _textSync(config: SmolConfig) {
    this.seen = config.messages;
    return { success: true as const, value: { output: "ok", toolCalls: [], model: config.model } };
  }
}

describe("BaseClient multimodal wiring", () => {
  const image = { kind: "base64", base64: "IMG", mimeType: "image/png" } as const;
  const bytesImage = { kind: "bytes", data: new Uint8Array([1, 2, 3]), mimeType: "image/png" } as const;

  it("gates an image to a text-only model with a Failure", async () => {
    const client = new StubAttachmentClient({ model: "o3-mini", messages: [] } as any);
    const res = await client.textSync({ model: "o3-mini", messages: [userMessage(["x", imagePart(image)])] } as any);
    expect(res.success).toBe(false);
  });

  it("resolves attachments (bytes → base64) before reaching _textSync", async () => {
    const client = new StubAttachmentClient({ model: "gpt-4o", messages: [] } as any);
    const res = await client.textSync({ model: "gpt-4o", messages: [userMessage(["x", imagePart(bytesImage)])] } as any);
    expect(res.success).toBe(true);
    // Start from a bytes source so this only passes if resolution actually ran.
    const part: any = client.seen[0]._content[1];
    expect(part.source.kind).toBe("base64");
    expect(part.source.base64).toBe(Buffer.from(bytesImage.data).toString("base64"));
  });

  it("textStream gates with an error chunk and no done chunk", async () => {
    const client = new StubAttachmentClient({ model: "o3-mini", messages: [] } as any);
    const chunks: any[] = [];
    for await (const c of client.textStream({ model: "o3-mini", messages: [userMessage(["x", imagePart(image)])] } as any)) {
      chunks.push(c);
    }
    expect(chunks.some((c) => c.type === "error")).toBe(true);
    expect(chunks.some((c) => c.type === "done")).toBe(false);
  });
});

