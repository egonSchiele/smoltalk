import { describe, it, expect } from "vitest";
import { SmolAnthropic } from "./anthropic.js";
import { userMessage } from "../classes/message/index.js";
import type { StreamChunk } from "../types.js";

/** Build a fake Anthropic streaming response simulating one web search:
 *  the query streams in via input_json_delta (split across two deltas),
 *  followed by a result block, a text answer, and final usage. */
async function* fakeWebSearchStream() {
  yield { type: "message_start", message: { usage: { input_tokens: 10 } } };
  // server_tool_use block: the web search itself
  yield {
    type: "content_block_start",
    index: 0,
    content_block: { type: "server_tool_use", name: "web_search" },
  };
  yield {
    type: "content_block_delta",
    index: 0,
    delta: { type: "input_json_delta", partial_json: '{"query":"claude opus' },
  };
  yield {
    type: "content_block_delta",
    index: 0,
    delta: { type: "input_json_delta", partial_json: ' 4.8 release date"}' },
  };
  yield { type: "content_block_stop", index: 0 };
  // web_search_tool_result block: sources arrive whole
  yield {
    type: "content_block_start",
    index: 1,
    content_block: {
      type: "web_search_tool_result",
      content: [
        { type: "web_search_result", url: "https://a.dev/x", title: "A" },
      ],
    },
  };
  yield { type: "content_block_stop", index: 1 };
  // text answer
  yield {
    type: "content_block_start",
    index: 2,
    content_block: { type: "text", text: "" },
  };
  yield {
    type: "content_block_delta",
    index: 2,
    delta: { type: "text_delta", text: "It shipped." },
  };
  yield {
    type: "content_block_delta",
    index: 2,
    delta: {
      type: "citations_delta",
      citation: { type: "web_search_result_location", url: "https://a.dev/x", title: "A" },
    },
  };
  yield { type: "content_block_stop", index: 2 };
  yield {
    type: "message_delta",
    usage: { output_tokens: 5, server_tool_use: { web_search_requests: 1 } },
  };
}

function clientWithFakeStream() {
  const client = new SmolAnthropic({
    model: "claude-sonnet-4-6",
    apiKey: { anthropic: "test-key" },
    messages: [],
  });
  (client as any).client = {
    messages: { create: async () => fakeWebSearchStream() },
  };
  return client;
}

describe("SmolAnthropic._textStream web search", () => {
  async function collect(): Promise<StreamChunk[]> {
    const client = clientWithFakeStream();
    const chunks: StreamChunk[] = [];
    for await (const chunk of client._textStream({
      model: "claude-sonnet-4-6",
      messages: [userMessage("when did opus 4.8 ship?")],
    } as any)) {
      chunks.push(chunk);
    }
    return chunks;
  }

  it("emits a live web_search chunk carrying the query", async () => {
    const chunks = await collect();
    const search = chunks.find((c) => c.type === "web_search");
    expect(search).toEqual({
      type: "web_search",
      query: "claude opus 4.8 release date",
    });
  });

  it("emits the web_search chunk before the done chunk", async () => {
    const chunks = await collect();
    const searchIdx = chunks.findIndex((c) => c.type === "web_search");
    const doneIdx = chunks.findIndex((c) => c.type === "done");
    expect(searchIdx).toBeGreaterThanOrEqual(0);
    expect(searchIdx).toBeLessThan(doneIdx);
  });

  it("folds queries, sources, citations, callCount and raw into the done result (parity with _textSync)", async () => {
    const chunks = await collect();
    const done = chunks.find((c) => c.type === "done");
    expect(done?.type).toBe("done");
    const results = (done as any).result.hostedToolResults;
    expect(results).toHaveLength(1);
    expect(results[0].tool).toBe("web_search");
    expect(results[0].queries).toEqual(["claude opus 4.8 release date"]);
    expect(results[0].sources?.[0].url).toBe("https://a.dev/x");
    expect(results[0].citations?.[0].url).toBe("https://a.dev/x");
    expect(results[0].callCount).toBe(1);
    // raw preserves the provider blocks (server_tool_use then result), matching
    // parseAnthropicHostedTools.
    const raw = results[0].raw as any[];
    expect(raw.some((b) => b.type === "server_tool_use" && b.input?.query === "claude opus 4.8 release date")).toBe(true);
    expect(raw.some((b) => b.type === "web_search_tool_result")).toBe(true);
  });

  it("does not emit a duplicate web_search chunk if a stop event replays", async () => {
    const client = new SmolAnthropic({
      model: "claude-sonnet-4-6",
      apiKey: { anthropic: "test-key" },
      messages: [],
    });
    (client as any).client = {
      messages: {
        create: async () =>
          (async function* () {
            yield { type: "message_start", message: { usage: { input_tokens: 5 } } };
            yield {
              type: "content_block_start",
              index: 0,
              content_block: { type: "server_tool_use", name: "web_search" },
            };
            yield {
              type: "content_block_delta",
              index: 0,
              delta: { type: "input_json_delta", partial_json: '{"query":"x"}' },
            };
            yield { type: "content_block_stop", index: 0 };
            yield { type: "content_block_stop", index: 0 }; // replayed
            yield { type: "message_delta", usage: { output_tokens: 1 } };
          })(),
      },
    };
    const chunks: StreamChunk[] = [];
    for await (const chunk of client._textStream({
      model: "claude-sonnet-4-6",
      messages: [userMessage("hi")],
    } as any)) {
      chunks.push(chunk);
    }
    expect(chunks.filter((c) => c.type === "web_search")).toHaveLength(1);
  });

  it("does not add hostedToolResults when no web search occurred", async () => {
    const client = new SmolAnthropic({
      model: "claude-sonnet-4-6",
      apiKey: { anthropic: "test-key" },
      messages: [],
    });
    (client as any).client = {
      messages: {
        create: async () =>
          (async function* () {
            yield { type: "message_start", message: { usage: { input_tokens: 3 } } };
            yield {
              type: "content_block_start",
              index: 0,
              content_block: { type: "text", text: "" },
            };
            yield {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: "hi" },
            };
            yield { type: "content_block_stop", index: 0 };
            yield { type: "message_delta", usage: { output_tokens: 1 } };
          })(),
      },
    };
    const chunks: StreamChunk[] = [];
    for await (const chunk of client._textStream({
      model: "claude-sonnet-4-6",
      messages: [userMessage("hi")],
    } as any)) {
      chunks.push(chunk);
    }
    expect(chunks.some((c) => c.type === "web_search")).toBe(false);
    const done = chunks.find((c) => c.type === "done") as any;
    expect(done.result.hostedToolResults).toBeUndefined();
  });
});
