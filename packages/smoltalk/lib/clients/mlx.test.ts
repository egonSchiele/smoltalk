import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import * as http from "node:http";
import { getClient } from "../client.js";
import { embed } from "../embed.js";
import { UserMessage } from "../classes/message/index.js";

type Received = { body: any; url: string };

// A fake mlx_lm.server. `reply` is what the next request gets back.
let server: http.Server;
let baseUrl: string;
let received: Received[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: {} };

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
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  baseUrl = `http://127.0.0.1:${port}/v1`;
});

afterAll(() => server.close());
afterEach(() => {
  received = [];
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
