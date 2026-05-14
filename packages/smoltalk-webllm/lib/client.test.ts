import { describe, it, expect, beforeEach } from "vitest";
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
