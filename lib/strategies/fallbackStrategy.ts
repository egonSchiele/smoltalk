import { IDStrategy } from "./idStrategy.js";
import { fromJSON } from "./index.js";
import { SmolStructuredOutputError, SmolTimeoutError } from "../smolError.js";
import {
  ModelLike,
  PromptResult,
  Result,
  SmolPromptConfig,
  success,
} from "../types.js";
import { BaseStrategy } from "./baseStrategy.js";
import {
  FallbackStrategyConfig,
  FallbackStrategyJSON,
  Strategy,
  StrategyJSON,
} from "./types.js";

export class FallbackStrategy extends BaseStrategy {
  public primaryStrategy: Strategy;
  public config: FallbackStrategyConfig;
  constructor(
    primaryStrategy: Strategy | ModelLike,
    config: FallbackStrategyConfig,
  ) {
    super();
    this.primaryStrategy =
      primaryStrategy instanceof BaseStrategy
        ? primaryStrategy
        : new IDStrategy(primaryStrategy as ModelLike);
    this.config = config;
  }

  toString() {
    return `FallbackStrategy([${this.primaryStrategy.toString()}], config: ${JSON.stringify(this.config)})`;
  }

  toShortString() {
    return `fallback([${this.primaryStrategy.toString()}])`;
  }

  async _text(config: SmolPromptConfig): Promise<Result<PromptResult>> {
    return this._textWithFallbacks(config, this.primaryStrategy, this.config);
  }
  async _textWithFallbacks(
    config: SmolPromptConfig,
    strategy: Strategy,
    fallbackStrategies: FallbackStrategyConfig,
  ): Promise<Result<PromptResult>> {
    try {
      const result = await strategy.text(config);
      return result;
    } catch (error) {
      // If the abort signal was triggered (e.g. by a race strategy winner
      // or external cancellation), stop without trying further fallbacks.
      if (config.abortSignal?.aborted) {
        return success({ output: null, toolCalls: [] });
      }

      if (error instanceof SmolTimeoutError) {
        if (
          fallbackStrategies.timeout &&
          fallbackStrategies.timeout.length > 0
        ) {
          this.statelogClient?.debug(
            "FallbackStrategy: falling back due to timeout",
            {
              failedStrategy: strategy.toString(),
            },
          );
          return this._textWithFallbacks(
            config,
            fromJSON(fallbackStrategies.timeout[0]) as Strategy,
            // from here on, only consider the remaining fallbacks for this specific reason
            { timeout: fallbackStrategies.timeout.slice(1) },
          );
        }
      } else if (error instanceof SmolStructuredOutputError) {
        if (
          fallbackStrategies.structuredOutputFailure &&
          fallbackStrategies.structuredOutputFailure.length > 0
        ) {
          this.statelogClient?.debug(
            "FallbackStrategy: falling back due to structured output failure",
            {
              failedStrategy: strategy.toString(),
            },
          );
          return this._textWithFallbacks(
            config,
            fromJSON(fallbackStrategies.structuredOutputFailure[0]) as Strategy,
            // from here on, only consider the remaining fallbacks for this specific reason
            {
              structuredOutputFailure:
                fallbackStrategies.structuredOutputFailure.slice(1),
            },
          );
        }
      }
      if (fallbackStrategies.error && fallbackStrategies.error.length > 0) {
        this.statelogClient?.debug(
          "FallbackStrategy: falling back due to error",
          {
            failedStrategy: strategy.toString(),
            error: (error as Error).message,
          },
        );
        return this._textWithFallbacks(
          config,
          fromJSON(fallbackStrategies.error[0]) as Strategy,
          // from here on, only consider the remaining fallbacks for this specific reason
          { error: fallbackStrategies.error.slice(1) },
        );
      }

      this.statelogClient?.debug("All strategies in FallbackStrategy failed", {
        fallbackStrategy: this.toJSON(),
        strategy,
        fallbackStrategies,
      });

      throw error;
    }
  }

  toJSON(): StrategyJSON {
    return {
      type: "fallback",
      params: {
        primaryStrategy: this.primaryStrategy.toJSON(),
        config: this.config,
      },
    };
  }

  static fromJSON(json: FallbackStrategyJSON): FallbackStrategy {
    const primaryStrategy = fromJSON(json.params.primaryStrategy) as Strategy;
    return new FallbackStrategy(primaryStrategy, json.params.config);
  }
}
