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
import type { MLCEngine } from "@mlc-ai/web-llm";
import { getEngine } from "./engine.js";

const ZERO_COST = {
  inputCost: 0,
  outputCost: 0,
  totalCost: 0,
  currency: "USD",
};

type EngineUsage = { prompt_tokens: number; completion_tokens: number };

function buildRequestArgs(
  promptConfig: SmolConfig,
  extras: { stream?: boolean } = {},
) {
  const tools = promptConfig.tools?.length
    ? promptConfig.tools.map((t) =>
        zodToOpenAITool(t.name, t.schema, { description: t.description }),
      )
    : undefined;

  const responseFormat = promptConfig.responseFormat
    ? {
        type: "json_schema" as const,
        json_schema: {
          name: promptConfig.responseFormatOptions?.name || "response",
          schema: promptConfig.responseFormat.toJSONSchema(),
        },
      }
    : undefined;

  return {
    messages: promptConfig.messages.map((m) => m.toOpenAIMessage()) as any,
    tools: tools as any,
    temperature: promptConfig.temperature,
    max_tokens: promptConfig.maxTokens,
    response_format: responseFormat as any,
    ...(extras.stream ? { stream: true } : {}),
  } as any;
}

function toolCallFromOpenAI(tc: any): ToolCall {
  return new ToolCall(tc.id ?? "", tc.function.name, tc.function.arguments);
}

function buildResult(
  promptConfig: SmolConfig,
  output: string | null,
  toolCalls: ToolCall[],
  usage: EngineUsage | undefined,
): PromptResult {
  return {
    output,
    toolCalls,
    model: promptConfig.model,
    usage: usage
      ? {
          inputTokens: usage.prompt_tokens ?? 0,
          outputTokens: usage.completion_tokens ?? 0,
        }
      : undefined,
    cost: { ...ZERO_COST },
  };
}

/**
 * Wires `config.abortSignal` to `engine.interruptGenerate()`. Returns a
 * cleanup function the caller must invoke once the request completes so the
 * listener doesn't leak.
 *
 * Note: `interruptGenerate()` is global to an engine — if multiple
 * generations are in flight on the same model, calling it interrupts all of
 * them. That's a limitation of @mlc-ai/web-llm, not of this wrapper.
 */
function attachAbort(
  engine: MLCEngine,
  signal: AbortSignal | undefined,
): () => void {
  if (!signal) return () => {};
  if (signal.aborted) {
    // Best-effort: kick off interrupt immediately, even if generation hasn't
    // started yet — web-llm tolerates this.
    engine.interruptGenerate().catch(() => {});
  }
  const onAbort = () => {
    engine.interruptGenerate().catch(() => {});
  };
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}

export class WebLLMClient extends BaseClient {
  async _textSync(promptConfig: SmolConfig): Promise<Result<PromptResult>> {
    const engine = getEngine(promptConfig.model);
    const detach = attachAbort(engine, this.getAbortSignal(promptConfig));

    try {
      const response: any = await engine.chat.completions.create(
        buildRequestArgs(promptConfig),
      );

      const choice = response.choices?.[0];
      const content: string | null = choice?.message?.content ?? null;
      const rawToolCalls = choice?.message?.tool_calls ?? [];
      const toolCalls: ToolCall[] = rawToolCalls.map(toolCallFromOpenAI);
      const usage: EngineUsage | undefined = response.usage;

      return success(buildResult(promptConfig, content, toolCalls, usage));
    } finally {
      detach();
    }
  }

  async *_textStream(promptConfig: SmolConfig): AsyncGenerator<StreamChunk> {
    const engine = getEngine(promptConfig.model);
    const detach = attachAbort(engine, this.getAbortSignal(promptConfig));

    try {
      const stream: any = await engine.chat.completions.create(
        buildRequestArgs(promptConfig, { stream: true }),
      );

      let outputText = "";
      let usage: EngineUsage | undefined;
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
        result: buildResult(promptConfig, outputText || null, toolCalls, usage),
      };
    } finally {
      detach();
    }
  }
}
