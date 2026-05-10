import { BaseClient } from "../clients/baseClient.js";
import { promptResult, success } from "../types.js";
import type {
  PromptResult,
  Result,
  SmolConfig,
  StreamChunk,
  TokenUsage,
} from "../types.js";

const DEFAULT_RESPONSE = "test response";

export class TestProvider extends BaseClient {
  private callIndex = 0;

  private nextResponse(config: SmolConfig): string {
    const responses = config.metadata?.testResponses as string[] | undefined;
    if (Array.isArray(responses) && responses.length > 0) {
      const response = responses[this.callIndex % responses.length];
      this.callIndex += 1;
      return response;
    }
    const single = config.metadata?.testResponse as string | undefined;
    return single ?? DEFAULT_RESPONSE;
  }

  private cannedUsage(config: SmolConfig): TokenUsage | undefined {
    return config.metadata?.testUsage as TokenUsage | undefined;
  }

  async _textSync(config: SmolConfig): Promise<Result<PromptResult>> {
    const output = this.nextResponse(config);
    return success(
      promptResult({
        output,
        toolCalls: [],
        model: config.model,
        usage: this.cannedUsage(config),
      }),
    );
  }

  async *_textStream(config: SmolConfig): AsyncGenerator<StreamChunk> {
    const output = this.nextResponse(config);
    yield { type: "text", text: output };
    yield {
      type: "done",
      result: promptResult({
        output,
        toolCalls: [],
        model: config.model,
        usage: this.cannedUsage(config),
      }),
    };
  }
}
