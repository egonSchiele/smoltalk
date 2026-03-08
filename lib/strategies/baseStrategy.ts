import { FallbackStrategy, RaceStrategy } from "../index.js";
import { getStatelogClient, StatelogClient } from "../statelogClient.js";
import { PromptResult, Result, SmolPromptConfig } from "../types.js";
import { IDStrategy } from "./idStrategy.js";
import {
  FallbackStrategyJSON,
  FallbackStrategyJSONSchema,
  IDStrategyJSON,
  IDStrategyJSONSchema,
  RaceStrategyJSON,
  RaceStrategyJSONSchema,
  Strategy,
  StrategyJSON,
} from "./types.js";

export class BaseStrategy implements Strategy {
  public statelogClient?: StatelogClient;
  async text(config: SmolPromptConfig): Promise<Result<PromptResult>> {
    this.statelogClient = config.statelog
      ? getStatelogClient(config.statelog as any)
      : undefined;

    this.statelogClient?.debug(`Starting strategy ${this.toString()}`);

    if (config.hooks?.onStrategyStart) {
      this.statelogClient?.debug(
        `Calling onStrategyStart hook for strategy ${this.toString()}`,
      );
      config.hooks.onStrategyStart(this, config);
    }

    return this._text(config);
  }

  async textSync(config: SmolPromptConfig): Promise<Result<PromptResult>> {
    this.statelogClient = config.statelog
      ? getStatelogClient(config.statelog as any)
      : undefined;

    this.statelogClient?.debug(`Starting strategy (sync) ${this.toString()}`);

    return this._textSync(config);
  }

  async textStream(
    config: SmolPromptConfig,
  ): Promise<Result<AsyncIterable<PromptResult>>> {
    throw new Error("textStream method not implemented.");
  }

  async _text(config: SmolPromptConfig): Promise<Result<PromptResult>> {
    throw new Error("_text method not implemented.");
  }

  async _textSync(config: SmolPromptConfig): Promise<Result<PromptResult>> {
    throw new Error("_textSync method not implemented.");
  }

  toJSON(): StrategyJSON {
    throw new Error("toJSON method not implemented.");
  }

  toString(): string {
    return "BaseStrategy";
  }

  toShortString(): string {
    return this.toString();
  }

  static fromJSON(json: StrategyJSON): Strategy {
    if (IDStrategyJSONSchema.safeParse(json).success) {
      return IDStrategy.fromJSON(json as IDStrategyJSON);
    } else if (RaceStrategyJSONSchema.safeParse(json).success) {
      return RaceStrategy.fromJSON(json as RaceStrategyJSON);
    } else if (FallbackStrategyJSONSchema.safeParse(json).success) {
      return FallbackStrategy.fromJSON(json as FallbackStrategyJSON);
    } else {
      throw new Error(`Unknown strategy JSON: ${JSON.stringify(json)}`);
    }
  }
}
