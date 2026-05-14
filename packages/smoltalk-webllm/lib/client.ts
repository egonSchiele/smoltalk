import {
  BaseClient,
  PromptResult,
  Result,
  SmolConfig,
  StreamChunk,
  ToolCall,
  success,
  zodToOpenAITool,
} from "smoltalk";
import { getEngine } from "./engine.js";

const ZERO_COST = {
  inputCost: 0,
  outputCost: 0,
  totalCost: 0,
  currency: "USD",
};

function buildTools(promptConfig: SmolConfig) {
  if (!promptConfig.tools?.length) return undefined;
  return promptConfig.tools.map((t) =>
    zodToOpenAITool(t.name, t.schema, { description: t.description }),
  );
}

function buildResponseFormat(promptConfig: SmolConfig): any | undefined {
  if (!promptConfig.responseFormat) return undefined;
  return {
    type: "json_schema",
    json_schema: {
      name: promptConfig.responseFormatOptions?.name || "response",
      schema: promptConfig.responseFormat.toJSONSchema(),
    },
  };
}

export class WebLLMClient extends BaseClient {
  async _textSync(promptConfig: SmolConfig): Promise<Result<PromptResult>> {
    const engine = getEngine(promptConfig.model);
    const messages = promptConfig.messages.map((m) => m.toOpenAIMessage());
    const tools = buildTools(promptConfig);

    const response: any = await engine.chat.completions.create({
      messages: messages as any,
      tools: tools as any,
      temperature: promptConfig.temperature,
      max_tokens: promptConfig.maxTokens,
      response_format: buildResponseFormat(promptConfig),
    } as any);

    const choice = response.choices?.[0];
    const content: string | null = choice?.message?.content ?? null;
    const rawToolCalls = choice?.message?.tool_calls ?? [];
    const toolCalls: ToolCall[] = rawToolCalls.map(
      (tc: any) =>
        new ToolCall(tc.id ?? "", tc.function.name, tc.function.arguments),
    );
    const usage = response.usage;

    return success({
      output: content,
      toolCalls,
      model: promptConfig.model,
      usage: usage
        ? {
            inputTokens: usage.prompt_tokens ?? 0,
            outputTokens: usage.completion_tokens ?? 0,
          }
        : undefined,
      cost: { ...ZERO_COST },
    });
  }

  async *_textStream(promptConfig: SmolConfig): AsyncGenerator<StreamChunk> {
    const engine = getEngine(promptConfig.model);
    const messages = promptConfig.messages.map((m) => m.toOpenAIMessage());
    const tools = buildTools(promptConfig);

    const stream: any = await engine.chat.completions.create({
      messages: messages as any,
      tools: tools as any,
      temperature: promptConfig.temperature,
      max_tokens: promptConfig.maxTokens,
      response_format: buildResponseFormat(promptConfig),
      stream: true,
    } as any);

    let outputText = "";
    let usage: { prompt_tokens: number; completion_tokens: number } | undefined;
    const toolCallBufs = new Map<
      number,
      { id?: string; name?: string; args: string }
    >();

    for await (const chunk of stream as AsyncIterable<any>) {
      const choice = chunk.choices?.[0];
      const deltaText: string | undefined = choice?.delta?.content;
      if (deltaText) {
        outputText += deltaText;
        yield { type: "text", text: deltaText };
      }

      const deltaTools = choice?.delta?.tool_calls ?? [];
      for (const dt of deltaTools) {
        const idx: number = dt.index ?? 0;
        const buf = toolCallBufs.get(idx) ?? { args: "" };
        if (dt.id) buf.id = dt.id;
        if (dt.function?.name) buf.name = dt.function.name;
        if (dt.function?.arguments) buf.args += dt.function.arguments;
        toolCallBufs.set(idx, buf);
      }

      if (chunk.usage) usage = chunk.usage;
    }

    const toolCalls: ToolCall[] = [];
    for (const buf of toolCallBufs.values()) {
      if (!buf.name) continue;
      const tc = new ToolCall(buf.id ?? "", buf.name, buf.args || "{}");
      toolCalls.push(tc);
      yield { type: "tool_call", toolCall: tc };
    }

    yield {
      type: "done",
      result: {
        output: outputText || null,
        toolCalls,
        model: promptConfig.model,
        usage: usage
          ? {
              inputTokens: usage.prompt_tokens ?? 0,
              outputTokens: usage.completion_tokens ?? 0,
            }
          : undefined,
        cost: { ...ZERO_COST },
      },
    };
  }
}
