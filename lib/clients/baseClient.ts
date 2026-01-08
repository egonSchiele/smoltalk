import { userMessage } from "../classes/message/index.js";
import { PromptConfig, PromptResult, Result, SmolClient } from "../types.js";

export class BaseClient implements SmolClient {
  text(config: PromptConfig): Promise<Result<PromptResult>> {
    throw new Error("Method not implemented.");
  }
  prompt(text: string, config?: PromptConfig): Promise<Result<PromptResult>> {
    const msg = userMessage(text);
    const promptConfig: PromptConfig = {
      ...config,
      messages: config?.messages ? [...config.messages, msg] : [msg],
    };
    return this.text(promptConfig);
  }
}
