import { describe, it, expect } from "vitest";
import { SmolOpenAiResponses } from "./openaiResponses.js";
import { assistantMessage, userMessage } from "../classes/message/index.js";
import { ToolCall } from "../classes/ToolCall.js";
import type { SmolConfig } from "../types.js";

// Encrypted reasoning from the Responses API goes back to the same model.
// See "Reasoning sent back to the model" in CLAUDE.md.
const REASONING_MODEL = "gpt-5-mini";
const PLAIN_MODEL = "gpt-4o";

const item = {
  type: "reasoning",
  id: "rs_1",
  encrypted_content: "xyz",
  summary: [{ type: "summary_text", text: "plan" }],
};
const call = { type: "function_call", id: "fc_1", call_id: "c1", name: "ls", arguments: "{}" };

function provider(model: string): SmolOpenAiResponses {
  return new SmolOpenAiResponses({
    model,
    provider: "openai-responses",
    messages: [],
    apiKey: { openAi: "k" },
  });
}

function config(model: string, extra: Partial<SmolConfig> = {}): SmolConfig {
  return { model, provider: "openai-responses", messages: [userMessage("hi")], ...extra } as SmolConfig;
}

const build = (model: string, extra: Partial<SmolConfig> = {}) =>
  (provider(model) as any).buildRequest(config(model, extra));

describe("SmolOpenAiResponses encrypted reasoning", () => {
  it("include asks for encrypted reasoning for a reasoning model", () => {
    expect(build(REASONING_MODEL).include).toEqual(["reasoning.encrypted_content"]);
  });

  it("a model that does not reason gets the same request as today", () => {
    expect(build(PLAIN_MODEL).include).toBeUndefined();
  });

  it("include keeps logprobs and adds encrypted reasoning", () => {
    const include = build(REASONING_MODEL, { logprobs: {} }).include;
    expect(include).toContain("message.output_text.logprobs");
    expect(include).toContain("reasoning.encrypted_content");
  });

  it("replayReasoning false asks for no encrypted reasoning", () => {
    expect(build(REASONING_MODEL, { replayReasoning: false }).include).toBeUndefined();
  });

  it("finds a reasoning model in per-call model data", () => {
    const modelData = {
      schemaVersion: 1,
      generatedAt: "2026-11-10T00:00:00Z",
      models: [
        {
          type: "text",
          modelName: "my-reasoner",
          provider: "openai-responses",
          maxInputTokens: 1000,
          maxOutputTokens: 1000,
          reasoning: { levels: ["low", "high"] },
        },
      ],
      hostedTools: [],
    } as any;
    expect(build("my-reasoner", { modelData }).include).toEqual(["reasoning.encrypted_content"]);
  });

  it("keeps the summary text for logs when replay is off and nothing is encrypted", async () => {
    const client = provider(REASONING_MODEL);
    const { encrypted_content: _dropped, ...plain } = item;
    (client as any).client.responses.create = async () => ({
      output: [plain, call],
      output_text: "",
      status: "completed",
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    const result = await client._textSync(config(REASONING_MODEL, { replayReasoning: false }));
    if (!result.success) throw new Error(result.error);
    expect(result.value.reasoning).toBe("plan");
    expect(result.value.reasoningRecord).toBeUndefined();
  });

  it("reads reasoning items into a record", async () => {
    const client = provider(REASONING_MODEL);
    (client as any).client.responses.create = async () => ({
      output: [item, call],
      output_text: "",
      status: "completed",
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    const result = await client._textSync(config(REASONING_MODEL));
    if (!result.success) throw new Error(result.error);
    expect(result.value.reasoning).toBe("plan");
    expect(result.value.reasoningRecord).toEqual({
      provider: "openai-responses",
      model: REASONING_MODEL,
      text: "",
      format: "responsesItems",
      responsesItems: [{ item, followedBy: "c1" }],
    });
  });

  it("a streamed reply keeps the reasoning item", async () => {
    const client = provider(REASONING_MODEL);
    (client as any).client.responses.stream = () => {
      async function* gen() {
        yield { type: "response.output_item.done", item };
        yield { type: "response.output_item.done", item: call };
        yield {
          type: "response.completed",
          response: { status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
        };
      }
      return gen();
    };
    let done: any;
    for await (const chunk of client._textStream(config(REASONING_MODEL))) {
      if (chunk.type === "done") done = chunk;
    }
    expect(done.result.reasoningRecord.responsesItems).toEqual([{ item, followedBy: "c1" }]);
  });

  it("the item goes back before the function call", () => {
    const record = {
      provider: "openai-responses",
      model: REASONING_MODEL,
      text: "",
      format: "responsesItems" as const,
      responsesItems: [{ item, followedBy: "c1" }],
    };
    const request = build(REASONING_MODEL, {
      messages: [
        userMessage("hi"),
        assistantMessage(null, { reasoning: record, toolCalls: [new ToolCall("c1", "ls", {})] }),
      ],
    });
    expect(request.input.map((entry: any) => entry.type)).toEqual(["message", "reasoning", "function_call"]);
  });
});
