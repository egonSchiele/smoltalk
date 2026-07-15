import { describe, it, expect } from "vitest";
import { SmolAnthropic } from "./anthropic.js";
import { SmolOpenAi } from "./openai.js";
import { SmolOllama } from "./ollama.js";
import { SmolGoogle } from "./google.js";
import { userMessage } from "../classes/message/index.js";
import type { StreamChunk } from "../types.js";

async function collectDone(gen: AsyncGenerator<StreamChunk>) {
  let done: any;
  for await (const c of gen) {
    if (c.type === "done") done = c.result;
  }
  return done;
}

describe("Anthropic stopReason", () => {
  function client(stopReason: string) {
    const c = new SmolAnthropic({
      model: "claude-sonnet-4-6",
      apiKey: { anthropic: "test-key" },
      messages: [],
    });
    (c as any).client = {
      messages: {
        create: async () => ({
          content: [{ type: "text", text: "hi" }],
          stop_reason: stopReason,
          usage: { input_tokens: 5, output_tokens: 3 },
        }),
      },
    };
    return c;
  }

  it("_textSync maps end_turn → stop and keeps the raw value", async () => {
    const res = await client("end_turn")._textSync({
      model: "claude-sonnet-4-6",
      messages: [userMessage("hi")],
    } as any);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.value.stopReason).toBe("stop");
      expect(res.value.rawStopReason).toBe("end_turn");
    }
  });

  it("_textSync maps max_tokens → length", async () => {
    const res = await client("max_tokens")._textSync({
      model: "claude-sonnet-4-6",
      messages: [userMessage("hi")],
    } as any);
    if (res.success) expect(res.value.stopReason).toBe("length");
  });

  it("_textStream surfaces the stop reason on the done chunk", async () => {
    const c = new SmolAnthropic({
      model: "claude-sonnet-4-6",
      apiKey: { anthropic: "test-key" },
      messages: [],
    });
    async function* fake() {
      yield { type: "message_start", message: { usage: { input_tokens: 5 } } };
      yield { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } };
      yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } };
      yield { type: "content_block_stop", index: 0 };
      yield { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } };
    }
    (c as any).client = { messages: { create: async () => fake() } };
    const done = await collectDone(
      c._textStream({ model: "claude-sonnet-4-6", messages: [userMessage("hi")] } as any),
    );
    expect(done.stopReason).toBe("stop");
    expect(done.rawStopReason).toBe("end_turn");
  });
});

describe("OpenAI stream stopReason", () => {
  it("_textStream maps tool_calls → tool_use", async () => {
    const c = new SmolOpenAi({
      model: "gpt-4o",
      apiKey: { openAi: "test" },
      messages: [],
    });
    async function* fake() {
      yield { choices: [{ delta: { content: "hi" }, finish_reason: null }] };
      yield { choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
    }
    (c as any).client = { chat: { completions: { create: async () => fake() } } };
    const done = await collectDone(
      c._textStream({ model: "gpt-4o", messages: [userMessage("hi")] } as any),
    );
    expect(done.stopReason).toBe("tool_use");
    expect(done.rawStopReason).toBe("tool_calls");
  });
});

describe("Ollama stopReason", () => {
  it("_textSync maps done_reason stop → stop", async () => {
    const c = new SmolOllama({
      model: "llama3.2",
      messages: [],
    } as any);
    (c as any).client = {
      chat: async () => ({
        message: { content: "hi" },
        done_reason: "stop",
        prompt_eval_count: 1,
        eval_count: 1,
      }),
    };
    const res = await c._textSync({ model: "llama3.2", messages: [userMessage("hi")] } as any);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.value.stopReason).toBe("stop");
      expect(res.value.rawStopReason).toBe("stop");
    }
  });
});

describe("Google stopReason", () => {
  function client() {
    const c = new SmolGoogle({
      model: "gemini-2.0-flash-lite",
      apiKey: { google: "test" },
      messages: [],
    } as any);
    return c;
  }

  it("_textSync maps STOP → stop", async () => {
    const c = client();
    (c as any).client = {
      models: {
        generateContent: async () => ({
          candidates: [
            { finishReason: "STOP", content: { parts: [{ text: "hi" }] } },
          ],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        }),
      },
    };
    const res = await c._textSync({ model: "gemini-2.0-flash-lite", messages: [userMessage("hi")] } as any);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.value.stopReason).toBe("stop");
      expect(res.value.rawStopReason).toBe("STOP");
    }
  });

  it("_textSync infers tool_use when STOP arrives with a function call", async () => {
    const c = client();
    (c as any).client = {
      models: {
        generateContent: async () => ({
          candidates: [
            {
              finishReason: "STOP",
              content: { parts: [{ functionCall: { name: "lookup", args: { q: "x" } } }] },
            },
          ],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        }),
      },
    };
    const res = await c._textSync({ model: "gemini-2.0-flash-lite", messages: [userMessage("hi")] } as any);
    if (res.success) {
      expect(res.value.stopReason).toBe("tool_use");
      expect(res.value.rawStopReason).toBe("STOP");
    }
  });
});
