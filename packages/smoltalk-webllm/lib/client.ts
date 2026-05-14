import {
  BaseClient,
  PromptResult,
  Result,
  SmolConfig,
  StreamChunk,
  success,
} from "smoltalk";
import { getEngine } from "./engine.js";

const ZERO_COST = {
  inputCost: 0,
  outputCost: 0,
  totalCost: 0,
  currency: "USD",
};

export class WebLLMClient extends BaseClient {
  async _textSync(promptConfig: SmolConfig): Promise<Result<PromptResult>> {
    const engine = getEngine(promptConfig.model);
    const messages = promptConfig.messages.map((m) => m.toOpenAIMessage());

    const response: any = await engine.chat.completions.create({
      messages: messages as any,
      temperature: promptConfig.temperature,
      max_tokens: promptConfig.maxTokens,
    } as any);

    const choice = response.choices?.[0];
    const content: string | null = choice?.message?.content ?? null;
    const usage = response.usage;

    return success({
      output: content,
      toolCalls: [],
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

    const stream: any = await engine.chat.completions.create({
      messages: messages as any,
      temperature: promptConfig.temperature,
      max_tokens: promptConfig.maxTokens,
      stream: true,
    } as any);

    let outputText = "";
    let usage: { prompt_tokens: number; completion_tokens: number } | undefined;

    for await (const chunk of stream as AsyncIterable<any>) {
      const choice = chunk.choices?.[0];
      const deltaText: string | undefined = choice?.delta?.content;
      if (deltaText) {
        outputText += deltaText;
        yield { type: "text", text: deltaText };
      }
      if (chunk.usage) usage = chunk.usage;
    }

    yield {
      type: "done",
      result: {
        output: outputText || null,
        toolCalls: [],
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
