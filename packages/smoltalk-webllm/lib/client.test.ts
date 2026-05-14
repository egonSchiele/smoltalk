import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import {
  __setEngineForTesting,
  __clearEnginesForTesting,
} from "./engine.js";
import { WebLLMClient } from "./client.js";
import { userMessage } from "smoltalk";

function fakeEngine(opts: {
  content?: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
}) {
  return {
    chat: {
      completions: {
        create: async (_args: any) => ({
          choices: [
            {
              message: { role: "assistant", content: opts.content ?? "hi" },
              finish_reason: "stop",
            },
          ],
          usage: opts.usage ?? { prompt_tokens: 3, completion_tokens: 2 },
        }),
      },
    },
    unload: async () => {},
  } as any;
}

describe("WebLLMClient.textSync — plain text", () => {
  beforeEach(() => __clearEnginesForTesting());

  it("returns the assistant text from the engine", async () => {
    __setEngineForTesting("m", fakeEngine({ content: "hello world" }));
    const config = {
      provider: "webllm" as const,
      model: "m",
      messages: [userMessage("Say hi")],
    };
    const client = new WebLLMClient(config);
    const result = await client.textSync(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.output).toBe("hello world");
      expect(result.value.model).toBe("m");
    }
  });

  it("populates token usage and a zero-cost CostEstimate", async () => {
    __setEngineForTesting(
      "m",
      fakeEngine({ usage: { prompt_tokens: 11, completion_tokens: 7 } }),
    );
    const config = {
      provider: "webllm" as const,
      model: "m",
      messages: [userMessage("hi")],
    };
    const client = new WebLLMClient(config);
    const result = await client.textSync(config);
    if (result.success) {
      expect(result.value.usage?.inputTokens).toBe(11);
      expect(result.value.usage?.outputTokens).toBe(7);
      expect(result.value.cost?.inputCost).toBe(0);
      expect(result.value.cost?.outputCost).toBe(0);
      expect(result.value.cost?.totalCost).toBe(0);
      expect(result.value.cost?.currency).toBe("USD");
    }
  });

  it("passes converted OpenAI-format messages to the engine", async () => {
    let received: any = null;
    __setEngineForTesting("m", {
      chat: {
        completions: {
          create: async (args: any) => {
            received = args;
            return {
              choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            };
          },
        },
      },
      unload: async () => {},
    } as any);
    const config = {
      provider: "webllm" as const,
      model: "m",
      messages: [userMessage("hello")],
    };
    const client = new WebLLMClient(config);
    await client.textSync(config);
    expect(received.messages).toHaveLength(1);
    expect(received.messages[0].role).toBe("user");
    expect(received.messages[0].content).toBe("hello");
  });
});

describe("WebLLMClient tool calls — sync", () => {
  beforeEach(() => __clearEnginesForTesting());

  it("returns toolCalls from the engine response", async () => {
    __setEngineForTesting("m", {
      chat: {
        completions: {
          create: async (_args: any) => ({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "get_weather",
                        arguments: JSON.stringify({ city: "Paris" }),
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 3 },
          }),
        },
      },
      unload: async () => {},
    } as any);

    const config = {
      provider: "webllm" as const,
      model: "m",
      messages: [userMessage("weather?")],
      tools: [
        {
          name: "get_weather",
          description: "weather",
          schema: z.object({ city: z.string() }),
        },
      ],
    };
    const client = new WebLLMClient(config);
    const result = await client.textSync(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.toolCalls).toHaveLength(1);
      expect(result.value.toolCalls[0].name).toBe("get_weather");
      expect(result.value.toolCalls[0].arguments).toEqual({ city: "Paris" });
    }
  });

  it("forwards tools to the engine in OpenAI shape", async () => {
    let received: any = null;
    __setEngineForTesting("m", {
      chat: {
        completions: {
          create: async (args: any) => {
            received = args;
            return {
              choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            };
          },
        },
      },
      unload: async () => {},
    } as any);
    const config = {
      provider: "webllm" as const,
      model: "m",
      messages: [userMessage("hi")],
      tools: [
        {
          name: "t",
          description: "d",
          schema: z.object({ x: z.string() }),
        },
      ],
    };
    const client = new WebLLMClient(config);
    await client.textSync(config);
    expect(received.tools).toBeDefined();
    expect(received.tools[0].function.name).toBe("t");
  });
});

describe("WebLLMClient structured output", () => {
  beforeEach(() => __clearEnginesForTesting());

  it("forwards response_format when responseFormat is a Zod schema", async () => {
    let received: any = null;
    __setEngineForTesting("m", {
      chat: {
        completions: {
          create: async (args: any) => {
            received = args;
            return {
              choices: [
                {
                  message: { content: JSON.stringify({ x: "hi" }) },
                  finish_reason: "stop",
                },
              ],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            };
          },
        },
      },
      unload: async () => {},
    } as any);

    const config = {
      provider: "webllm" as const,
      model: "m",
      messages: [userMessage("hi")],
      responseFormat: z.object({ x: z.string() }),
    };
    const client = new WebLLMClient(config);
    await client.textSync(config);
    expect(received.response_format).toBeDefined();
    expect(received.response_format.type).toBe("json_schema");
    expect(received.response_format.json_schema.schema).toBeDefined();
  });
});

describe("WebLLMClient.textStream", () => {
  beforeEach(() => __clearEnginesForTesting());

  it("yields text chunks then a done chunk", async () => {
    __setEngineForTesting("m", {
      chat: {
        completions: {
          create: async (_args: any) => {
            async function* gen() {
              yield {
                choices: [{ delta: { content: "Hel" }, finish_reason: null }],
              };
              yield {
                choices: [{ delta: { content: "lo" }, finish_reason: null }],
              };
              yield {
                choices: [{ delta: {}, finish_reason: "stop" }],
                usage: { prompt_tokens: 2, completion_tokens: 2 },
              };
            }
            return gen();
          },
        },
      },
      unload: async () => {},
    } as any);

    const config = {
      provider: "webllm" as const,
      model: "m",
      messages: [userMessage("hi")],
    };
    const client = new WebLLMClient(config);
    const chunks: any[] = [];
    for await (const c of client.textStream(config)) {
      chunks.push(c);
    }
    const text = chunks.filter((c) => c.type === "text").map((c) => c.text);
    expect(text.join("")).toBe("Hello");
    const last = chunks[chunks.length - 1];
    expect(last.type).toBe("done");
    expect(last.result.output).toBe("Hello");
    expect(last.result.usage?.inputTokens).toBe(2);
    expect(last.result.cost?.currency).toBe("USD");
  });
});
