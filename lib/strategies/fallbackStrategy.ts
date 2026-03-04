import { text } from "../functions.js";
import { Model } from "../model.js";
import { SmolStructuredOutputError, SmolTimeoutError } from "../smolError.js";
import { SmolPromptConfig } from "../types.js";
import { BaseStrategy } from "./baseStrategy.js";
import { FallbackStrategyConfig, Strategy } from "./types.js";

export class FallbackStrategy extends BaseStrategy {
  public strategies: Strategy[];
  public config: FallbackStrategyConfig;
  constructor(strategies: Strategy[], config: FallbackStrategyConfig) {
    super();
    this.strategies = strategies;
    this.config = config;
  }

  async _text(config: SmolPromptConfig) {
    for (let i = 0; i < this.strategies.length; i++) {
      const strategy = this.strategies[i];
      try {
        const result = await strategy.text(config);
        return result;
      } catch (error) {
        if (error instanceof SmolTimeoutError) {
          if (this.config.fallbackOn.includes("timeout")) {
            continue;
          }
        } else if (error instanceof SmolStructuredOutputError) {
          if (this.config.fallbackOn.includes("structuredOutputFailure")) {
            continue;
          }
        } else {
          if (this.config.fallbackOn.includes("error")) {
            continue;
          }
        }
        throw error;
      }
    }
    throw new Error(`All fallback strategies failed.`);
  }
}
