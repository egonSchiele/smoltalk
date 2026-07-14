import { describe, it, expect } from "vitest";
import { SmolAnthropic, responseFormatToolName } from "./anthropic.js";
import { userMessage } from "../classes/message/index.js";
import { z } from "zod";

function makeClient(model = "claude-sonnet-4-6") {
  return new SmolAnthropic({
    model,
    apiKey: { anthropic: "test-key" },
    messages: [],
  } as any);
}

const schema = z.object({
  path: z.enum(["simple", "complex"]),
  plan: z.array(z.string()),
});

function build(client: SmolAnthropic, config: any) {
  return (client as any).buildRequest(config);
}

describe("responseFormatToolName", () => {
  it("defaults to 'response'", () => {
    expect(responseFormatToolName({ messages: [] } as any)).toBe("response");
  });
  it("sanitizes an invalid user-supplied name to Anthropic's tool-name charset", () => {
    expect(
      responseFormatToolName({
        messages: [],
        responseFormatOptions: { name: "My Plan!" },
      } as any),
    ).toBe("My_Plan_");
  });
});

describe("SmolAnthropic.buildRequest — structured output (Defect A)", () => {
  it("registers the schema as a tool and forces it when no tools/thinking", () => {
    const client = makeClient();
    const { tools, toolChoice, responseFormatToolName: name } = build(client, {
      model: "claude-sonnet-4-6",
      messages: [userMessage("classify this")],
      responseFormat: schema,
    });
    expect(name).toBe("response");
    const responseTool = tools.find((t: any) => t.name === "response");
    expect(responseTool).toBeDefined();
    expect(responseTool.input_schema.type).toBe("object");
    expect(Object.keys(responseTool.input_schema.properties)).toEqual(
      expect.arrayContaining(["path", "plan"]),
    );
    // Forced single-tool use guarantees schema-conforming JSON on attempt 1.
    expect(toolChoice).toEqual({
      type: "tool",
      name: "response",
      disable_parallel_tool_use: true,
    });
  });

  it("does NOT force tool_choice when extended thinking is enabled", () => {
    const client = makeClient("claude-haiku-4-5");
    const { tools, toolChoice } = build(client, {
      model: "claude-haiku-4-5",
      messages: [userMessage("classify this")],
      responseFormat: schema,
      thinking: { enabled: true, budgetTokens: 2000 },
    });
    // The response tool is still available for the model to call...
    expect(tools.some((t: any) => t.name === "response")).toBe(true);
    // ...but Anthropic rejects a forced tool_choice with thinking, so we don't force.
    expect(toolChoice).toBeUndefined();
  });

  it("does NOT force tool_choice when the caller has function tools", () => {
    const client = makeClient();
    const { tools, toolChoice } = build(client, {
      model: "claude-sonnet-4-6",
      messages: [userMessage("classify this")],
      responseFormat: schema,
      tools: [
        { name: "lookup", description: "look things up", schema: z.object({ q: z.string() }) },
      ],
    });
    expect(tools.some((t: any) => t.name === "response")).toBe(true);
    expect(tools.some((t: any) => t.name === "lookup")).toBe(true);
    // Forcing the response tool would prevent 'lookup' from ever being called.
    expect(toolChoice).toBeUndefined();
  });

  it("adds nothing when responseFormat is absent", () => {
    const client = makeClient();
    const { tools, toolChoice, responseFormatToolName: name } = build(client, {
      model: "claude-sonnet-4-6",
      messages: [userMessage("hi")],
    });
    expect(tools).toBeUndefined();
    expect(toolChoice).toBeUndefined();
    expect(name).toBeUndefined();
  });
});

describe("SmolAnthropic._textSync — structured output extraction", () => {
  it("surfaces the response tool's input as output, not as a tool call", async () => {
    const client = makeClient();
    let sentToolChoice: any;
    (client as any).client = {
      messages: {
        create: async (req: any) => {
          sentToolChoice = req.tool_choice;
          return {
            content: [
              {
                type: "tool_use",
                id: "tu_1",
                name: "response",
                input: { path: "complex", plan: ["a", "b"] },
              },
            ],
            usage: { input_tokens: 10, output_tokens: 5 },
          };
        },
      },
    };
    const res = await (client as any)._textSync({
      model: "claude-sonnet-4-6",
      messages: [userMessage("classify this")],
      responseFormat: schema,
    });
    expect(res.success).toBe(true);
    expect(sentToolChoice).toEqual({
      type: "tool",
      name: "response",
      disable_parallel_tool_use: true,
    });
    // Structured value is surfaced as (stringified) output; NOT a tool call.
    expect(res.value.toolCalls).toHaveLength(0);
    expect(JSON.parse(res.value.output)).toEqual({ path: "complex", plan: ["a", "b"] });
  });

  it("still returns genuine (user) tool calls as tool calls", async () => {
    const client = makeClient();
    (client as any).client = {
      messages: {
        create: async () => ({
          content: [
            { type: "tool_use", id: "tu_1", name: "lookup", input: { q: "x" } },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      },
    };
    const res = await (client as any)._textSync({
      model: "claude-sonnet-4-6",
      messages: [userMessage("look it up")],
      responseFormat: schema,
      tools: [
        { name: "lookup", description: "look", schema: z.object({ q: z.string() }) },
      ],
    });
    expect(res.success).toBe(true);
    expect(res.value.toolCalls).toHaveLength(1);
    expect(res.value.toolCalls[0].name).toBe("lookup");
    expect(res.value.output).toBeNull();
  });
});

describe("SmolAnthropic._textStream — structured output extraction", () => {
  function streamOf(events: any[]) {
    return {
      async *[Symbol.asyncIterator]() {
        for (const e of events) yield e;
      },
    };
  }

  it("surfaces the response tool's streamed args as output, not a tool call", async () => {
    const client = makeClient();
    (client as any).client = {
      messages: {
        create: async () =>
          streamOf([
            { type: "message_start", message: { usage: { input_tokens: 3 } } },
            {
              type: "content_block_start",
              index: 0,
              content_block: { type: "tool_use", id: "tu_1", name: "response" },
            },
            {
              type: "content_block_delta",
              index: 0,
              delta: { type: "input_json_delta", partial_json: '{"path":"simple",' },
            },
            {
              type: "content_block_delta",
              index: 0,
              delta: { type: "input_json_delta", partial_json: '"plan":["x"]}' },
            },
            { type: "content_block_stop", index: 0 },
            { type: "message_delta", usage: { output_tokens: 7 } },
          ]),
      },
    };
    const chunks: any[] = [];
    for await (const c of (client as any)._textStream({
      model: "claude-sonnet-4-6",
      messages: [userMessage("classify")],
      responseFormat: schema,
    })) {
      chunks.push(c);
    }
    // No tool_call chunk leaks for the synthetic response tool.
    expect(chunks.some((c) => c.type === "tool_call")).toBe(false);
    const done = chunks.find((c) => c.type === "done");
    expect(done.result.toolCalls).toHaveLength(0);
    expect(JSON.parse(done.result.output)).toEqual({ path: "simple", plan: ["x"] });
  });
});
