import { SmolPromptConfig, Result, PromptResult } from "../types.js";

export interface Strategy {
  text(config: SmolPromptConfig): Promise<Result<PromptResult>>;
  _text(config: SmolPromptConfig): Promise<Result<PromptResult>>;
  textSync(config: SmolPromptConfig): Promise<Result<PromptResult>>;
  _textSync(config: SmolPromptConfig): Promise<Result<PromptResult>>;
  textStream(
    config: SmolPromptConfig,
  ): Promise<Result<AsyncIterable<PromptResult>>>;
}

type FallbackReason = "error" | "timeout" | "structuredOutputFailure";

export type FallbackStrategyConfig = {
  fallbackOn: FallbackReason[];
};
