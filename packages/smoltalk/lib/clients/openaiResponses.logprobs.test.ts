import { describe, it, expect } from "vitest";
import { SmolOpenAiResponses } from "./openaiResponses.js";
import { userMessage } from "../classes/message/index.js";
import type { SmolConfig } from "../types.js";

// The Responses sync path awaits `responses.create(...)`; the stream path
// iterates `responses.stream(...)`. These drivers feed canned values into the
// real _textSync / _textStream so the logprobs mapping runs without a network
// call.
class LogprobProvider extends SmolOpenAiResponses {
  publicBuild(config: SmolConfig) {
    return (this as any).buildRequest(config);
  }
}

function logprobProvider(): LogprobProvider {
  return new LogprobProvider({
    model: "gpt-4o",
    provider: "openai-responses",
    messages: [],
    apiKey: { openAi: "k" },
  });
}

async function textSyncWith(response: any, config: Partial<SmolConfig>) {
  const provider = logprobProvider();
  (provider as any).client.responses.create = async () => response;
  return provider._textSync({
    model: "gpt-4o",
    provider: "openai-responses",
    messages: [userMessage("hi")],
    ...config,
  } as SmolConfig);
}

async function lastChunkOfStreamWith(events: any[], config: Partial<SmolConfig>) {
  const provider = logprobProvider();
  (provider as any).client.responses.stream = () => {
    async function* gen() {
      for (const event of events) {
        yield event;
      }
    }
    return gen();
  };
  let done: any;
  for await (const chunk of provider._textStream({
    model: "gpt-4o",
    provider: "openai-responses",
    messages: [userMessage("hi")],
    ...config,
  } as SmolConfig)) {
    if (chunk.type === "done") {
      done = chunk;
    }
  }
  return done;
}

describe("SmolOpenAiResponses logprobs", () => {
  it("asks the Responses API to include logprobs", () => {
    const c = logprobProvider();
    const base = { model: "gpt-4o", messages: [userMessage("hi")] } as SmolConfig;
    expect(c.publicBuild(base)).not.toHaveProperty("include");
    expect(c.publicBuild({ ...base, logprobs: {} })).toMatchObject({
      include: ["message.output_text.logprobs"],
    });
    expect(c.publicBuild({ ...base, logprobs: { top: 4 } })).toMatchObject({
      include: ["message.output_text.logprobs"],
      top_logprobs: 4,
    });
  });

  it("maps an output_text part's logprobs onto the result", async () => {
    const response = {
      output_text: "Hi!",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "Hi!",
              logprobs: [
                { token: "Hi", logprob: -0.1, top_logprobs: [] },
                { token: "!", logprob: -0.5, top_logprobs: [] },
              ],
            },
          ],
        },
      ],
      status: "completed",
      usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 },
    };
    const result = await textSyncWith(response, { logprobs: {} });
    if (!result.success) {
      throw new Error(result.error);
    }
    expect(result.value.logprobs).toEqual([
      { token: "Hi", logprob: -0.1 },
      { token: "!", logprob: -0.5 },
    ]);
  });

  it("collects streamed logprobs onto the done result", async () => {
    const events = [
      { type: "response.output_text.delta", delta: "Hi" },
      { type: "response.output_text.delta", delta: "!" },
      {
        type: "response.output_text.done",
        logprobs: [
          { token: "Hi", logprob: -0.1, top_logprobs: [] },
          { token: "!", logprob: -0.5, top_logprobs: [] },
        ],
      },
      {
        type: "response.completed",
        response: {
          status: "completed",
          usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 },
        },
      },
    ];
    const done = await lastChunkOfStreamWith(events, { logprobs: {} });
    expect(done.result.logprobs).toEqual([
      { token: "Hi", logprob: -0.1 },
      { token: "!", logprob: -0.5 },
    ]);
  });

  it("leaves logprobs absent when the response has none", async () => {
    const response = {
      output_text: "Hi",
      output: [{ type: "message", content: [{ type: "output_text", text: "Hi" }] }],
      status: "completed",
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    };
    const result = await textSyncWith(response, {});
    if (!result.success) {
      throw new Error(result.error);
    }
    expect(result.value).not.toHaveProperty("logprobs");
  });
});
