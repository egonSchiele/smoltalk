import { SmolPromptConfig, Result, PromptResult } from "../types.js";

export interface Strategy {
  text(config: SmolPromptConfig): Promise<Result<PromptResult>>;
  _text(config: SmolPromptConfig): Promise<Result<PromptResult>>;
  textSync(config: SmolPromptConfig): Promise<Result<PromptResult>>;
  _textSync(config: SmolPromptConfig): Promise<Result<PromptResult>>;
  textStream(
    config: SmolPromptConfig,
  ): Promise<Result<AsyncIterable<PromptResult>>>;
  toJSON(): StrategyJSON;
  toString(): string;
  toShortString(): string;
}

type FallbackReason = "error" | "timeout" | "structuredOutputFailure";

export type FallbackStrategyConfig = {
  fallbackOn: FallbackReason[];
};

export type StrategyJSON =
  | string
  | { type: "id"; params: { model: string } }
  | { type: "race"; params: { strategies: StrategyJSON[] } }
  | {
      type: "fallback";
      params: { strategies: StrategyJSON[]; config: FallbackStrategyConfig };
    };
