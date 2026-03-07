import { getStatelogClient, StatelogClient } from "../statelogClient.js";
import { PromptResult, Result, SmolPromptConfig } from "../types.js";
import { Strategy, StrategyJSON } from "./types.js";

export class BaseStrategy implements Strategy {
  public statelogClient?: StatelogClient;
  async text(config: SmolPromptConfig): Promise<Result<PromptResult>> {
    this.statelogClient = config.statelog
      ? getStatelogClient(config.statelog as any)
      : undefined;

    if (config.hooks?.onStrategyStart) {
      config.hooks.onStrategyStart(this, config);
    }

    return this._text({ ...config, strategy: undefined });
  }

  async textSync(config: SmolPromptConfig): Promise<Result<PromptResult>> {
    this.statelogClient = config.statelog
      ? getStatelogClient(config.statelog as any)
      : undefined;

    return this._textSync({ ...config, strategy: undefined });
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
}
