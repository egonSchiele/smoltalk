import { getStatelogClient, StatelogClient } from "../statelogClient.js";
import { PromptResult, Result, SmolPromptConfig, StreamChunk } from "../types.js";
import { Strategy, StrategyJSON } from "./types.js";

export class BaseStrategy implements Strategy {
  public statelogClient?: StatelogClient;

  text(
    config: Omit<SmolPromptConfig, "stream">,
  ): Promise<Result<PromptResult>>;

  text(
    config: Omit<SmolPromptConfig, "stream"> & { stream: false },
  ): Promise<Result<PromptResult>>;

  text(
    config: Omit<SmolPromptConfig, "stream"> & { stream: true },
  ): AsyncGenerator<StreamChunk>;

  text(
    config: SmolPromptConfig,
  ): Promise<Result<PromptResult>> | AsyncGenerator<StreamChunk>;

  text(
    config: SmolPromptConfig,
  ): Promise<Result<PromptResult>> | AsyncGenerator<StreamChunk> {
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

    if (config.stream) {
      return this.textStream(config);
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

  textStream(config: SmolPromptConfig): AsyncGenerator<StreamChunk> {
    this.statelogClient = config.statelog
      ? getStatelogClient(config.statelog as any)
      : undefined;

    this.statelogClient?.debug(`Starting strategy (stream) ${this.toString()}`);

    return this._textStream(config);
  }

  async _text(config: SmolPromptConfig): Promise<Result<PromptResult>> {
    throw new Error("_text method not implemented.");
  }

  async _textSync(config: SmolPromptConfig): Promise<Result<PromptResult>> {
    throw new Error("_textSync method not implemented.");
  }

  async *_textStream(config: SmolPromptConfig): AsyncGenerator<StreamChunk> {
    const result = await this._textSync(config);
    if (result.success) {
      if (result.value.output) {
        yield { type: "text", text: result.value.output };
      }
      for (const tc of result.value.toolCalls) {
        yield { type: "tool_call", toolCall: tc };
      }
      yield { type: "done", result: result.value };
    } else {
      yield { type: "error", error: result.error };
    }
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
