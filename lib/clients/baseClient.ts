import { userMessage, assistantMessage } from "../classes/message/index.js";
import { getLogger } from "../logger.js";
import { ModelName } from "../models.js";
import {
  PromptConfig,
  PromptResult,
  Result,
  SmolClient,
  SmolConfig,
  StreamChunk,
  success,
} from "../types.js";
import { z } from "zod";

const DEFAULT_NUM_RETRIES = 2;

export class BaseClient implements SmolClient {
  protected config: SmolConfig;

  constructor(config: SmolConfig) {
    this.config = config || {};
  }
  text(
    promptConfig: Omit<PromptConfig, "stream">,
  ): Promise<Result<PromptResult>>;

  text(
    promptConfig: Omit<PromptConfig, "stream"> & { stream: false },
  ): Promise<Result<PromptResult>>;

  text(
    promptConfig: Omit<PromptConfig, "stream"> & { stream: true },
  ): AsyncGenerator<StreamChunk>;

  text(
    promptConfig: PromptConfig,
  ): Promise<Result<PromptResult>> | AsyncGenerator<StreamChunk>;

  text(
    promptConfig: PromptConfig,
  ): Promise<Result<PromptResult>> | AsyncGenerator<StreamChunk> {
    if (promptConfig.stream) {
      return this.textStream(promptConfig);
    } else {
      return this.textSync(promptConfig);
    }
  }

  checkMessageLimit(promptConfig: PromptConfig): Result<PromptResult> | null {
    if (
      promptConfig.maxMessages !== undefined &&
      promptConfig.messages.length > promptConfig.maxMessages
    ) {
      const logger = getLogger();
      logger.warn(
        `Message limit exceeded: ${promptConfig.messages.length} messages sent, but maxMessages is set to ${promptConfig.maxMessages}. Aborting request.`,
      );
      return {
        success: false,
        error: `Message limit exceeded: ${promptConfig.messages.length} messages exceeds the maxMessages limit of ${promptConfig.maxMessages}`,
      };
    }
    return null;
  }

  async textSync(promptConfig: PromptConfig): Promise<Result<PromptResult>> {
    const messageLimitResult = this.checkMessageLimit(promptConfig);
    if (messageLimitResult) return messageLimitResult;

    const { continue: shouldContinue, newPromptConfig } =
      this.checkForToolLoops(promptConfig);
    if (!shouldContinue) {
      return {
        success: true,
        value: { output: null, toolCalls: [], model: this.config.model },
      };
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

  extractResponse(promptConfig: PromptConfig, rawValue: any, schema: any): any {
    // 1. Direct match — try parsing as-is
    const direct = schema.safeParse(rawValue);

    if (direct.success) {
      return direct.data;
    } else if (promptConfig.responseFormatOptions?.allowExtraKeys) {
      const nonExtraKeyErrors = direct.error.issues.filter(
        (issue: any) => issue.code !== "unrecognized_keys",
      );
      if (nonExtraKeyErrors.length === 0) {
        // Only extra key errors — allow it through
        return rawValue;
      }
    }

    // 2. String → try JSON.parse, then recurse
    if (typeof rawValue === "string") {
      const stripped = rawValue
        .trim()
        .replace(/^```json\s*/, "")
        .replace(/```\s*$/, "");
      try {
        return this.extractResponse(promptConfig, JSON.parse(stripped), schema);
      } catch {}
      return rawValue;
    }

    // 3. Null/undefined/primitive — nothing to unwrap
    if (rawValue == null || typeof rawValue !== "object") {
      return rawValue;
    }

    // 4. Array — scan every element
    if (Array.isArray(rawValue)) {
      for (const item of rawValue) {
        const inner = schema.safeParse(item);
        if (inner.success) return inner.data;
      }
    }

    // 5. Object with "response" or "properties" key — unwrap
    const wrapKeys = ["response", "properties"];
    for (const key of wrapKeys) {
      if (key in rawValue) {
        const inner = schema.safeParse(rawValue[key]);
        if (inner.success) return inner.data[key];
      }
    }

    // 6. Shallow search — check every value of the object
    for (const key of Object.keys(rawValue)) {
      const inner = schema.safeParse(rawValue[key]);
      if (inner.success) return inner.data;
    }

    // 7. Wrap object with "response" and see if that matches the schema
    const wrapped = { response: rawValue };
    const wrappedParse = schema.safeParse(wrapped);
    if (wrappedParse.success) {
      return wrappedParse.data;
    }

    // 8. Nothing worked — throw error
    throw direct.error;
  }

  async textWithRetry(
    promptConfig: PromptConfig,
    retries: number,
  ): Promise<Result<PromptResult>> {
    const result = await this._textSync(promptConfig);
    if (result.success) {
      if (!("output" in result.value)) {
        const retryMessages = [
          ...promptConfig.messages,
          userMessage(
            `You returned "undefined" instead of a valid response. Please provide a valid response.`,
          ),
        ];

        return this.textWithRetry(
          { ...promptConfig, messages: retryMessages },
          retries - 1,
        );
      }

      const { output } = result.value;
      if (
        output !== null &&
        promptConfig.responseFormat &&
        promptConfig.responseFormatOptions?.strict &&
        retries > 0
      ) {
        const allowExtraKeys =
          promptConfig.responseFormatOptions?.allowExtraKeys ?? false;

        try {
          const parsed = JSON.parse(output);
          const parseResult = this.extractResponse(
            promptConfig,
            parsed,
            promptConfig.responseFormat,
          );
          return success({
            ...result.value,
            output: parseResult,
          });
        } catch (err) {
          const errorMessage = (err as Error).message;
          const logger = getLogger();
          logger.debug(
            `Response format validation failed (retries left: ${retries}): `,
            errorMessage,
            "output:",
            JSON.stringify(output, null, 2),
            "responseFormat:",
            JSON.stringify(promptConfig.responseFormat, null, 2),
          );
          if (err instanceof z.ZodError) {
            logger.debug("Zod error details:", z.prettifyError(err));
          }

          const retryMessages = [
            ...promptConfig.messages,
            assistantMessage(output),
            userMessage(
              `Your previous response failed validation. Please fix the following errors and try again:\n${errorMessage}`,
            ),
          ];

          return this.textWithRetry(
            { ...promptConfig, messages: retryMessages },
            retries - 1,
          );
        }
      }
    }
    return result;
  }

  async _textSync(promptConfig: PromptConfig): Promise<Result<PromptResult>> {
    throw new Error("Method not implemented.");
  }
  prompt(
    text: string,
    promptConfig?: PromptConfig,
  ): Promise<Result<PromptResult>> | AsyncGenerator<StreamChunk> {
    const msg = userMessage(text);
    const newPromptConfig: PromptConfig = {
      ...promptConfig,
      messages: promptConfig?.messages
        ? [...promptConfig.messages, msg]
        : [msg],
    };
    return this.text(newPromptConfig);
  }

  async *textStream(config: PromptConfig): AsyncGenerator<StreamChunk> {
    const messageLimitResult = this.checkMessageLimit(config);
    if (messageLimitResult) {
      yield {
        type: "error",
        error:
          messageLimitResult.success === false
            ? messageLimitResult.error
            : "Message limit exceeded",
      };
      return;
    }

    const { continue: shouldContinue, newPromptConfig } =
      this.checkForToolLoops(config);
    if (!shouldContinue) {
      yield {
        type: "done",
        result: {
          output: null,
          toolCalls: [],
          model: this.config.model,
        },
      };
      return;
    }
    yield* this._textStream(newPromptConfig);
  }

  // default implementation of text stream just calls the non-streaming version and yields the result
  // clients that support streaming can override this to provide a streaming implementation
  async *_textStream(config: PromptConfig): AsyncGenerator<StreamChunk> {
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
}
