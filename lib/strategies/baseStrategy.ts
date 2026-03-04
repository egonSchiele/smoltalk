import { PromptResult, Result, SmolPromptConfig } from "../types.js";
import { Strategy } from "./types.js";

export class BaseStrategy implements Strategy {
  async text(config: SmolPromptConfig): Promise<Result<PromptResult>> {
    return this._text({ ...config, strategy: undefined });
  }

  async textSync(config: SmolPromptConfig): Promise<Result<PromptResult>> {
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
}
