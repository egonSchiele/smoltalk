import { describe, it, expect } from "vitest";
import { BaseClient } from "./baseClient.js";
import { userMessage, assistantMessage } from "../classes/message/index.js";
import { PromptConfig, StreamChunk } from "../types.js";

class TestClient extends BaseClient {
  async _textSync(config: PromptConfig) {
    return {
      success: true as const,
      value: { output: "hello", toolCalls: [], model: this.config.model },
    };
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
