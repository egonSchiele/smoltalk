import { SmolStructuredOutputError, SmolTimeoutError } from "../smolError.js";
import { SmolPromptConfig, success } from "../types.js";
import { BaseStrategy } from "./baseStrategy.js";
import {
  FallbackStrategyConfig,
  FallbackStrategyJSON,
  Strategy,
  StrategyJSON,
} from "./types.js";

export class FallbackStrategy extends BaseStrategy {
  public strategies: Strategy[];
  public config: FallbackStrategyConfig;
  constructor(strategies: Strategy[], config: FallbackStrategyConfig) {
    super();
    this.strategies = strategies;
    this.config = config;
  }

  toString() {
    return `FallbackStrategy([${this.strategies.map((s) => s.toString()).join(", ")}], config: ${JSON.stringify(this.config)})`;
  }

  toShortString() {
    return `fallback([${this.strategies.map((s) => s.toShortString?.() || s.toString()).join(", ")}])`;
  }

  async _text(config: SmolPromptConfig) {
    for (let i = 0; i < this.strategies.length; i++) {
      const strategy = this.strategies[i];
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
          if (this.config.fallbackOn.includes("timeout")) {
            this.statelogClient?.debug(
              "FallbackStrategy: falling back due to timeout",
              {
                failedStrategy: strategy.toString(),
                strategyIndex: i,
              },
            );
            continue;
          }
        } else if (error instanceof SmolStructuredOutputError) {
          if (this.config.fallbackOn.includes("structuredOutputFailure")) {
            this.statelogClient?.debug(
              "FallbackStrategy: falling back due to structured output failure",
              {
                failedStrategy: strategy.toString(),
                strategyIndex: i,
              },
            );
            continue;
          }
        }
        if (this.config.fallbackOn.includes("error")) {
          this.statelogClient?.debug(
            "FallbackStrategy: falling back due to error",
            {
              failedStrategy: strategy.toString(),
              strategyIndex: i,
              error: (error as Error).message,
            },
          );
          continue;
        }

        this.statelogClient?.debug("FallbackStrategy error", {
          failedStrategy: strategy.toString(),
          strategyIndex: i,
          strategies: this.strategies.map((s) => s.toString()),
          error: (error as Error).message,
        });

        throw error;
      }
    }
    this.statelogClient?.debug("All strategies in FallbackStrategy failed", {
      strategies: this.strategies.map((s) => s.toString()),
    });

    throw new Error(`All fallback strategies failed.`);
  }

  toJSON(): StrategyJSON {
    return {
      type: "fallback",
      params: {
        strategies: this.strategies.map((s) => s.toJSON()),
        config: this.config,
      },
    };
  }

  static fromJSON(json: FallbackStrategyJSON): FallbackStrategy {
    const strategies = json.params.strategies.map((s) =>
      BaseStrategy.fromJSON(s),
    );
    return new FallbackStrategy(strategies, json.params.config);
  }
}
