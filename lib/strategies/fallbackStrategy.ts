import {
  SmolContentPolicyError,
  SmolContextWindowExceededError,
  SmolStructuredOutputError,
  SmolTimeoutError,
} from "../smolError.js";
import {
  ModelLike,
  ModelParam,
  PromptResult,
  Result,
  SmolPromptConfig,
  success,
} from "../types.js";
import { BaseStrategy } from "./baseStrategy.js";
import { IDStrategy } from "./idStrategy.js";
import { fromJSON } from "./index.js";
import {
  FallbackStrategyConfig,
  FallbackStrategyJSONSchema,
  Strategy,
  StrategyJSON,
} from "./types.js";

export class FallbackStrategy extends BaseStrategy {
  public primaryStrategy: Strategy;
  public config: FallbackStrategyConfig;
  constructor(primaryStrategy: ModelParam, config: FallbackStrategyConfig) {
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
      const result = await (strategy.text(config) as Promise<Result<PromptResult>>);
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
      } else if (error instanceof SmolContentPolicyError) {
        if (
          fallbackStrategies.contentPolicyViolation &&
          fallbackStrategies.contentPolicyViolation.length > 0
        ) {
          this.statelogClient?.debug(
            "FallbackStrategy: falling back due to content policy violation",
            {
              failedStrategy: strategy.toString(),
            },
          );
          return this._textWithFallbacks(
            config,
            fromJSON(fallbackStrategies.contentPolicyViolation[0]) as Strategy,
            {
              contentPolicyViolation:
                fallbackStrategies.contentPolicyViolation.slice(1),
            },
          );
        }
      } else if (error instanceof SmolContextWindowExceededError) {
        if (
          fallbackStrategies.contextWindowExceeded &&
          fallbackStrategies.contextWindowExceeded.length > 0
        ) {
          this.statelogClient?.debug(
            "FallbackStrategy: falling back due to context window exceeded",
            {
              failedStrategy: strategy.toString(),
            },
          );
          return this._textWithFallbacks(
            config,
            fromJSON(
              fallbackStrategies.contextWindowExceeded[0],
            ) as Strategy,
            {
              contextWindowExceeded:
                fallbackStrategies.contextWindowExceeded.slice(1),
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

  static fromJSON(json: unknown): FallbackStrategy {
    const parsed = FallbackStrategyJSONSchema.parse(json);
    const primaryStrategy = fromJSON(parsed.params.primaryStrategy) as Strategy;
    return new FallbackStrategy(primaryStrategy, parsed.params.config);
  }
}
