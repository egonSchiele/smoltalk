import { userMessage } from "../classes/message/index.js";
import { getLogger } from "../logger.js";
import { PromptConfig, PromptResult, Result, SmolClient } from "../types.js";

const DEFAULT_NUM_RETRIES = 2;

export class BaseClient implements SmolClient {
  async text(config: PromptConfig): Promise<Result<PromptResult>> {
    return this.textWithRetry(
      config,
      config.responseFormatOptions?.numRetries || DEFAULT_NUM_RETRIES
    );
  }

  async textWithRetry(
    config: PromptConfig,
    retries: number
  ): Promise<Result<PromptResult>> {
    const result = await this._text(config);
    if (result.success) {
      const { output } = result.value;
      if (
        output !== null &&
        config.responseFormat &&
        config.responseFormatOptions?.strict &&
        retries > 0
      ) {
        try {
          const parsed = config.responseFormat.parse(JSON.parse(output));
        } catch (err) {
          // bummer, response wasn't in the right format
          const logger = getLogger();
          logger.error(
            `Response format validation failed (retries left: ${retries}): `,
            (err as Error).message
          );
          return this.textWithRetry(config, retries - 1);
        }
      }
    }
    return result;
  }

  async _text(config: PromptConfig): Promise<Result<PromptResult>> {
    throw new Error("Method not implemented.");
  }
  async prompt(
    text: string,
    config?: PromptConfig
  ): Promise<Result<PromptResult>> {
    const msg = userMessage(text);
    const promptConfig: PromptConfig = {
      ...config,
      messages: config?.messages ? [...config.messages, msg] : [msg],
    };
    return await this.text(promptConfig);
  }
}
