import { userMessage } from "../classes/message/index.js";
import { getLogger } from "../logger.js";
import {
  PromptConfig,
  PromptResult,
  Result,
  SmolClient,
  SmolConfig,
} from "../types.js";

const DEFAULT_NUM_RETRIES = 2;

export class BaseClient implements SmolClient {
  protected config: SmolConfig;

  constructor(config: SmolConfig) {
    this.config = config || {};
  }

  async text(promptConfig: PromptConfig): Promise<Result<PromptResult>> {
    const { continue: shouldContinue, newPromptConfig } =
      this.checkForToolLoops(promptConfig);
    if (!shouldContinue) {
      return { success: true, value: { output: null, toolCalls: [] } };
    }
    return this.textWithRetry(
      newPromptConfig,
      newPromptConfig.responseFormatOptions?.numRetries || DEFAULT_NUM_RETRIES,
    );
  }

  checkForToolLoops(promptConfig: PromptConfig): {
    continue: boolean;
    newPromptConfig: PromptConfig;
  } {
    if (!this.config.toolLoopDetection?.enabled) {
      return { continue: true, newPromptConfig: promptConfig };
    }

    const toolCallCounts: Record<string, number> = {};
    const toolCallMessages = promptConfig.messages.filter(
      (m) => m.role === "tool",
    );
    for (const msg of toolCallMessages) {
      toolCallCounts[msg.name] ||= 0;
      toolCallCounts[msg.name] += 1;
    }

    for (const [toolName, count] of Object.entries(toolCallCounts)) {
      if (
        count >= this.config.toolLoopDetection.maxConsecutive &&
        !(this.config.toolLoopDetection.excludeTools ?? []).includes(toolName)
      ) {
        const intervention =
          this.config.toolLoopDetection.intervention || "remove-tool";
        const logger = getLogger();
        logger.warn(
          `Tool loop detected for tool "${toolName}" called ${count} times. Intervention: ${intervention}`,
        );
        switch (intervention) {
          case "remove-tool":
            const newTools = promptConfig.tools?.filter(
              (t) => t.name !== toolName,
            );
            const newPromptConfig = {
              ...promptConfig,
              tools: newTools,
            };
            return { continue: true, newPromptConfig };
          case "remove-all-tools":
            return {
              continue: true,
              newPromptConfig: { ...promptConfig, tools: [] },
            };
          case "throw-error":
            throw new Error(
              `Tool loop detected for tool "${toolName}". Aborting request.`,
            );
          case "halt-execution":
            return { continue: false, newPromptConfig: promptConfig };
        }
      }
    }
    return { continue: true, newPromptConfig: promptConfig };
  }

  async textWithRetry(
    promptConfig: PromptConfig,
    retries: number,
  ): Promise<Result<PromptResult>> {
    const result = await this._text(promptConfig);
    if (result.success) {
      const { output } = result.value;
      if (
        output !== null &&
        promptConfig.responseFormat &&
        promptConfig.responseFormatOptions?.strict &&
        retries > 0
      ) {
        try {
          const parsed = promptConfig.responseFormat.parse(JSON.parse(output));
        } catch (err) {
          // bummer, response wasn't in the right format
          const logger = getLogger();
          logger.error(
            `Response format validation failed (retries left: ${retries}): `,
            (err as Error).message,
          );
          return this.textWithRetry(promptConfig, retries - 1);
        }
      }
    }
    return result;
  }

  async _text(promptConfig: PromptConfig): Promise<Result<PromptResult>> {
    throw new Error("Method not implemented.");
  }
  async prompt(
    text: string,
    promptConfig?: PromptConfig,
  ): Promise<Result<PromptResult>> {
    const msg = userMessage(text);
    const newPromptConfig: PromptConfig = {
      ...promptConfig,
      messages: promptConfig?.messages
        ? [...promptConfig.messages, msg]
        : [msg],
    };
    return await this.text(newPromptConfig);
  }
}
