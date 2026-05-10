import { describe, it, expect } from "vitest";
import { registerProvider } from "./client.js";
import { text, textSync, textStream } from "./functions.js";
import { TestProvider } from "./testing/index.js";
import { userMessage, BaseMessage } from "./classes/message/index.js";
import type { StreamChunk } from "./types.js";

registerProvider("test", TestProvider);

const baseConfig = {
  model: "any-model",
  provider: "test",
  metadata: { testResponse: "hello" },
  messages: [userMessage("hi")],
};

describe("text()", () => {
  it("returns a Promise when stream is omitted", async () => {
    const result = await text(baseConfig);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.output).toBe("hello");
  });

  it("returns a Promise when stream is false", async () => {
    const result = await text({ ...baseConfig, stream: false });
    expect(result.success).toBe(true);
  });

  it("returns an AsyncGenerator when stream is true", async () => {
    const gen = text({ ...baseConfig, stream: true });
    expect(typeof (gen as AsyncGenerator<StreamChunk>)[Symbol.asyncIterator]).toBe("function");
    const chunks: StreamChunk[] = [];
    for await (const c of gen as AsyncGenerator<StreamChunk>) chunks.push(c);
    expect(chunks.some((c) => c.type === "text")).toBe(true);
    expect(chunks.some((c) => c.type === "done")).toBe(true);
  });
});

describe("textSync()", () => {
  it("accepts plain JSON messages and converts them internally", async () => {
    const plainJson: any = [{ role: "user", content: "hi" }];
    const config = { ...baseConfig, messages: plainJson };
    const result = await textSync(config);
    expect(result.success).toBe(true);
    // After fixMessagesIfNecessary, config.messages is reassigned to converted instances
    expect(config.messages[0] instanceof BaseMessage).toBe(true);
  });

  it("uses the first response from testResponses array", async () => {
    const cfg = {
      model: "any",
      provider: "test",
      metadata: { testResponses: ["first", "second", "third"] },
      messages: [userMessage("x")],
    };
    const r1 = await textSync(cfg);
    expect(r1.success && r1.value.output).toBe("first");
  });
});

describe("textStream()", () => {
  it("yields text chunks then a done chunk", async () => {
    const chunks: StreamChunk[] = [];
    for await (const c of textStream(baseConfig)) chunks.push(c);
    expect(chunks.find((c) => c.type === "text")).toBeDefined();
    expect(chunks.find((c) => c.type === "done")).toBeDefined();
  });

  it("passes abortSignal through (best-effort: completes without error)", async () => {
    const controller = new AbortController();
    const chunks: StreamChunk[] = [];
    for await (const c of textStream({ ...baseConfig, abortSignal: controller.signal })) {
      chunks.push(c);
    }
    expect(chunks.length).toBeGreaterThan(0);
  });
});
