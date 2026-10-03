import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import * as http from "node:http";
import { getClient } from "../client.js";
import { embed } from "../embed.js";
import { UserMessage } from "../classes/message/index.js";
import { STRUCTURED_FOLLOW_UP } from "./structuredAfterTools.js";
import { z } from "zod";

type Received = { body: any; url: string };

// A fake mlx_lm.server. `reply` is what the next request gets back.
let server: http.Server;
let baseUrl: string;
let received: Received[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: {} };
// Replies for the next requests, in order, for a call that makes several.
// When it is empty, every request gets `reply`.
let replies: { status: number; body: unknown }[] = [];

function chatReply(model: string, content: string | undefined, extra: Record<string, unknown> = {}) {
  const message: Record<string, unknown> = { role: "assistant", ...extra };
  if (content !== undefined) message.content = content;
  return {
    id: "chatcmpl-1",
    object: "chat.completion",
    model,
    choices: [{ index: 0, finish_reason: "stop", message }],
    usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
  };
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      received.push({ body: raw === "" ? null : JSON.parse(raw), url: req.url ?? "" });
      const next = replies.shift() ?? reply;
      res.writeHead(next.status, { "content-type": "application/json" });
      res.end(JSON.stringify(next.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  baseUrl = `http://127.0.0.1:${port}/v1`;
});

afterAll(() => server.close());
afterEach(() => {
  received = [];
  replies = [];
  delete process.env.MLX_BASE_URL;
});

const messages = [new UserMessage("hi")];

describe("SmolMlx", () => {
  it("sends the model name as given", async () => {
    reply = { status: 200, body: chatReply("mlx-community/Qwen3-Coder-Next-4bit", "hello") };
    const client = getClient({ provider: "mlx", model: "mlx-community/Qwen3-Coder-Next-4bit", baseUrl: { mlx: baseUrl } });
    const result = await client.textSync({ messages });
    expect(result.success).toBe(true);
    expect(received[0].body.model).toBe("mlx-community/Qwen3-Coder-Next-4bit");
    expect(received[0].url).toBe("/v1/chat/completions");
  });

  it("sends maxTokens to the server as max_tokens", async () => {
    reply = { status: 200, body: chatReply("m", "hello") };
    const client = getClient({ provider: "mlx", model: "m", baseUrl: { mlx: baseUrl } });
    const result = await client.textSync({ messages, maxTokens: 50 });
    expect(result.success).toBe(true);
    expect(received[0].body.max_tokens).toBe(50);
  });

  it("needs no API key", async () => {
    reply = { status: 200, body: chatReply("m", "hello") };
    delete process.env.OPENAI_COMPAT_API_KEY;
    const client = getClient({ provider: "mlx", model: "m", baseUrl: { mlx: baseUrl } });
    const result = await client.textSync({ messages });
    expect(result.success).toBe(true);
  });

  it("reads MLX_BASE_URL when no config is given", async () => {
    process.env.MLX_BASE_URL = baseUrl;
    reply = { status: 200, body: chatReply("m", "hello") };
    const client = getClient({ provider: "mlx", model: "m" });
    const result = await client.textSync({ messages });
    expect(result.success).toBe(true);
  });

  it("reports zero cost and the token counts", async () => {
    reply = { status: 200, body: chatReply("m", "hello") };
    const client = getClient({ provider: "mlx", model: "m", baseUrl: { mlx: baseUrl } });
    const result = await client.textSync({ messages });
    if (!result.success) throw new Error(result.error);
    // resolveCostUsd returns 0, which calculateUsageAndCost wraps into a
    // CostEstimate object — so cost is { totalCost: 0, ... }, not the number 0.
    expect(result.value.cost?.totalCost).toBe(0);
    // TokenUsage uses inputTokens/outputTokens, not prompt/completion.
    expect(result.value.usage.inputTokens).toBe(12);
    expect(result.value.usage.outputTokens).toBe(5);
  });

  it("surfaces a 404 error message from the server", async () => {
    // textSync throws every non-abort error — the public text()/textSync()
    // wrappers in functions.ts are `getClient(config).textSync(config)` with no
    // catch, so a server error propagates to the caller. The thrown error must
    // carry the server's body message.
    reply = {
      status: 404,
      body: { error: { message: "This server is serving a. It is not serving b." } },
    };
    const client = getClient({ provider: "mlx", model: "b", baseUrl: { mlx: baseUrl } });
    await expect(client.textSync({ messages })).rejects.toThrow("It is not serving b");
  });

  it("parses a tool-call reply that has no content key", async () => {
    reply = {
      status: 200,
      body: chatReply("m", undefined, {
        tool_calls: [{ id: "c1", type: "function", function: { name: "add", arguments: '{"a":1,"b":2}' } }],
      }),
    };
    const client = getClient({ provider: "mlx", model: "m", baseUrl: { mlx: baseUrl } });
    const result = await client.textSync({ messages });
    if (!result.success) throw new Error(result.error);
    expect(result.value.toolCalls.length).toBe(1);
    expect(result.value.toolCalls[0].name).toBe("add");
    // PromptResult.output is `string | null` and is built as `output || null`;
    // a missing `content` field becomes null, not "".
    expect(result.value.output).toBeNull();
  });

  it("embed posts to /v1/embeddings at the mlx base URL with zero cost", async () => {
    reply = {
      status: 200,
      body: {
        object: "list",
        model: "m",
        data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3] }],
        usage: { prompt_tokens: 4, total_tokens: 4 },
      },
    };
    const result = await embed("hi", { provider: "mlx", model: "m", baseUrl: { mlx: baseUrl } });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.embeddings).toEqual([[0.1, 0.2, 0.3]]);
      expect(result.value.tokenUsage).toEqual({ inputTokens: 4, outputTokens: 0 });
      expect(result.value.costEstimate?.totalCost).toBe(0);
    }
    expect(received[0].url).toBe("/v1/embeddings");
    expect(received[0].body.model).toBe("m");
    expect(received[0].body.input).toEqual(["hi"]);
    // Float, not the SDK's base64 default: a server that ignores the field
    // and returns float arrays must not be decoded as base64.
    expect(received[0].body.encoding_format).toBe("float");
  });

  it("embed returns a failure Result, not a throw, when the server errors", async () => {
    // Callers like Agency's memory code rely on a failure Result here.
    reply = { status: 500, body: { error: { message: "no embedding model loaded" } } };
    const result = await embed("hi", { provider: "mlx", model: "m", baseUrl: { mlx: baseUrl } });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("no embedding model loaded");
    }
  });
});

// The server cannot hold a reply to a schema while the model may still call
// a tool, so a call with both is made as two requests.
describe("SmolMlx with tools and a response format", () => {
  const tools = [
    {
      name: "getTemperature",
      description: "The temperature in a city.",
      schema: z.object({ city: z.string() }),
    },
  ];
  const responseFormat = z.object({ answer: z.string() });
  const toolCallReply = chatReply("m", undefined, {
    tool_calls: [
      {
        id: "call-1",
        type: "function",
        function: { name: "getTemperature", arguments: '{"city":"Oslo"}' },
      },
    ],
  });

  function mlxClient() {
    return getClient({ provider: "mlx", model: "m", baseUrl: { mlx: baseUrl } });
  }

  it("asks for the format in a second request once the model answers", async () => {
    replies = [
      { status: 200, body: chatReply("m", "It is 21 degrees in Oslo.") },
      { status: 200, body: chatReply("m", '{"answer":"21 degrees"}') },
    ];
    const result = await mlxClient().textSync({ messages, tools, responseFormat });
    if (!result.success) throw new Error(result.error);

    expect(received).toHaveLength(2);
    // The tool round: the tools, and no schema for the server to drop.
    expect(received[0].body.tools).toHaveLength(1);
    expect(received[0].body.response_format).toBeUndefined();
    expect(received[0].body.tool_choice).toBeUndefined();
    // The format round: the same tools so the prompt prefix is unchanged,
    // tool calls ruled out, and the schema.
    expect(received[1].body.tools).toEqual(received[0].body.tools);
    expect(received[1].body.tool_choice).toBe("none");
    expect(received[1].body.response_format.type).toBe("json_schema");
    // It keeps the conversation and adds the model's answer and the ask.
    const sent = received[1].body.messages;
    expect(sent.slice(0, -2)).toEqual(received[0].body.messages);
    expect(sent[sent.length - 2]).toMatchObject({
      role: "assistant",
      content: "It is 21 degrees in Oslo.",
    });
    expect(sent[sent.length - 1]).toMatchObject({ role: "user", content: STRUCTURED_FOLLOW_UP });

    expect(result.value.output).toBe('{"answer":"21 degrees"}');
    expect(result.value.toolCalls).toEqual([]);
    // Both requests are counted.
    expect(result.value.usage.inputTokens).toBe(24);
    expect(result.value.usage.outputTokens).toBe(10);
  });

  it("returns a tool call from the first request without a second", async () => {
    replies = [{ status: 200, body: toolCallReply }];
    const result = await mlxClient().textSync({ messages, tools, responseFormat });
    if (!result.success) throw new Error(result.error);
    expect(received).toHaveLength(1);
    expect(result.value.toolCalls).toHaveLength(1);
    expect(result.value.toolCalls[0].name).toBe("getTemperature");
  });

  it("drops a tool call a server returns from the format request", async () => {
    // A server that does not honour tool_choice could still return one. The
    // tool round is over, so it must not reach the caller.
    replies = [
      { status: 200, body: chatReply("m", "It is 21 degrees in Oslo.") },
      { status: 200, body: toolCallReply },
    ];
    const result = await mlxClient().textSync({ messages, tools, responseFormat });
    if (!result.success) throw new Error(result.error);
    expect(received).toHaveLength(2);
    expect(result.value.toolCalls).toEqual([]);
  });

  it("sends one request when separateFromTools is false", async () => {
    reply = { status: 200, body: chatReply("m", '{"answer":"21 degrees"}') };
    const result = await mlxClient().textSync({
      messages,
      tools,
      responseFormat,
      responseFormatOptions: { separateFromTools: false },
    });
    expect(result.success).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0].body.tools).toHaveLength(1);
    expect(received[0].body.response_format.type).toBe("json_schema");
  });

  it("sends one request when the call has no tools", async () => {
    reply = { status: 200, body: chatReply("m", '{"answer":"21 degrees"}') };
    const result = await mlxClient().textSync({ messages, responseFormat });
    expect(result.success).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0].body.response_format.type).toBe("json_schema");
  });

  it("sends one request when the tool list is empty", async () => {
    reply = { status: 200, body: chatReply("m", '{"answer":"21 degrees"}') };
    const result = await mlxClient().textSync({ messages, tools: [], responseFormat });
    expect(result.success).toBe(true);
    expect(received).toHaveLength(1);
  });
});
