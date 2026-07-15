import { describe, it, expect } from "vitest";
import { SmolAnthropic, anthropicSupportsStructuredOutput } from "./anthropic.js";
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

describe("anthropicSupportsStructuredOutput", () => {
  it("true for Claude 4.x+ / Sonnet 5 / Fable / unknown, false for 3.x and 2.x", () => {
    expect(anthropicSupportsStructuredOutput("claude-opus-4-8")).toBe(true);
    expect(anthropicSupportsStructuredOutput("claude-sonnet-4-6")).toBe(true);
    expect(anthropicSupportsStructuredOutput("claude-haiku-4-5")).toBe(true);
    expect(anthropicSupportsStructuredOutput("claude-opus-4-5")).toBe(true);
    expect(anthropicSupportsStructuredOutput("claude-sonnet-5")).toBe(true);
    expect(anthropicSupportsStructuredOutput("claude-fable-5")).toBe(true);
    expect(anthropicSupportsStructuredOutput("some-future-model")).toBe(true);
    expect(anthropicSupportsStructuredOutput("claude-3-7-sonnet-latest")).toBe(false);
    expect(anthropicSupportsStructuredOutput("claude-3-5-haiku-latest")).toBe(false);
    expect(anthropicSupportsStructuredOutput("claude-2.1")).toBe(false);
  });
});

describe("SmolAnthropic.buildRequest — native structured output (Defect A)", () => {
  it("emits output_config.format json_schema when responseFormat is set", () => {
    const client = makeClient();
    const { outputConfig, tools } = build(client, {
      model: "claude-sonnet-4-6",
      messages: [userMessage("classify this")],
      responseFormat: schema,
    });
    expect(outputConfig.format.type).toBe("json_schema");
    expect(Object.keys(outputConfig.format.schema.properties)).toEqual(
      expect.arrayContaining(["path", "plan"]),
    );
    // No synthetic tool is added — structured output is not emulated via tools.
    expect(tools).toBeUndefined();
  });

  it("keeps the caller's function tools alongside the format (they compose)", () => {
    const client = makeClient();
    const { outputConfig, tools } = build(client, {
      model: "claude-sonnet-4-6",
      messages: [userMessage("classify this")],
      responseFormat: schema,
      tools: [
        { name: "lookup", description: "look things up", schema: z.object({ q: z.string() }) },
      ],
    });
    // Native structured output + function calling in the same request.
    expect(outputConfig.format.type).toBe("json_schema");
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("lookup");
  });

  it("merges effort and format into one output_config", () => {
    const client = makeClient("claude-sonnet-4-6");
    const { outputConfig } = build(client, {
      model: "claude-sonnet-4-6",
      messages: [userMessage("classify this")],
      responseFormat: schema,
      reasoningEffort: "high",
    });
    expect(outputConfig.effort).toBe("high");
    expect(outputConfig.format.type).toBe("json_schema");
  });

  it("omits the format on legacy claude-3.x models (unsupported)", () => {
    const client = makeClient("claude-3-7-sonnet-latest");
    const { outputConfig } = build(client, {
      model: "claude-3-7-sonnet-latest",
      messages: [userMessage("classify this")],
      responseFormat: schema,
    });
    // No native support → no output_config at all here (no effort set either).
    expect(outputConfig).toBeUndefined();
  });

  it("adds no output_config.format when responseFormat is absent", () => {
    const client = makeClient();
    const { outputConfig } = build(client, {
      model: "claude-sonnet-4-6",
      messages: [userMessage("hi")],
    });
    expect(outputConfig).toBeUndefined();
  });
});

describe("SmolAnthropic._textSync — structured output request wiring", () => {
  it("sends output_config.format and returns the JSON text as output", async () => {
    const client = makeClient();
    let sentRequest: any;
    (client as any).client = {
      messages: {
        create: async (req: any) => {
          sentRequest = req;
          return {
            // Native structured output comes back as a normal text block whose
            // content is guaranteed schema-conforming JSON.
            content: [
              { type: "text", text: '{"path":"complex","plan":["a","b"]}' },
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
    expect(sentRequest.output_config.format.type).toBe("json_schema");
    expect(sentRequest.tool_choice).toBeUndefined();
    expect(res.value.toolCalls).toHaveLength(0);
    expect(JSON.parse(res.value.output)).toEqual({ path: "complex", plan: ["a", "b"] });
  });

  it("returns genuine tool calls as tool calls (format + tools coexist)", async () => {
    const client = makeClient();
    let sentRequest: any;
    (client as any).client = {
      messages: {
        create: async (req: any) => {
          sentRequest = req;
          return {
            content: [
              { type: "tool_use", id: "tu_1", name: "lookup", input: { q: "x" } },
            ],
            usage: { input_tokens: 10, output_tokens: 5 },
          };
        },
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
    // Both the format and the tool were sent on the same request.
    expect(sentRequest.output_config.format.type).toBe("json_schema");
    expect(sentRequest.tools).toHaveLength(1);
    // The model chose to call the tool this turn.
    expect(res.value.toolCalls).toHaveLength(1);
    expect(res.value.toolCalls[0].name).toBe("lookup");
    expect(res.value.output).toBeNull();
  });
});

describe("SmolAnthropic._textStream — structured output request wiring", () => {
  function streamOf(events: any[]) {
    return {
      async *[Symbol.asyncIterator]() {
        for (const e of events) yield e;
      },
    };
  }

  it("sends output_config.format and streams the JSON as text/output", async () => {
    const client = makeClient();
    let sentRequest: any;
    (client as any).client = {
      messages: {
        create: async (req: any) => {
          sentRequest = req;
          return streamOf([
            { type: "message_start", message: { usage: { input_tokens: 3 } } },
            {
              type: "content_block_start",
              index: 0,
              content_block: { type: "text", text: "" },
            },
            {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: '{"path":"simple",' },
            },
            {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: '"plan":["x"]}' },
            },
            { type: "content_block_stop", index: 0 },
            { type: "message_delta", usage: { output_tokens: 7 } },
          ]);
        },
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
    expect(sentRequest.output_config.format.type).toBe("json_schema");
    expect(chunks.some((c) => c.type === "tool_call")).toBe(false);
    const done = chunks.find((c) => c.type === "done");
    expect(done.result.toolCalls).toHaveLength(0);
    expect(JSON.parse(done.result.output)).toEqual({ path: "simple", plan: ["x"] });
  });
});
