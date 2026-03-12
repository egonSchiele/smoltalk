import {
  userMessage,
  assistantMessage,
} from "../classes/message/index.js";
import { latencyTracker } from "../latencyTracker.js";
import { getLogger } from "../util/logger.js";
import { ModelName } from "../models.js";
import { SmolStructuredOutputError } from "../smolError.js";
import { getStatelogClient, StatelogClient } from "../statelogClient.js";
import {
  PromptConfig,
  PromptResult,
  ResolvedSmolConfig,
  Result,
  SmolClient,
  SmolConfig,
  StreamChunk,
  success,
} from "../types.js";
import { z } from "zod";

const DEFAULT_NUM_RETRIES = 2;

export class BaseClient implements SmolClient {
  protected config: ResolvedSmolConfig;
  protected statelogClient?: StatelogClient;

  constructor(config: ResolvedSmolConfig) {
    this.config = config || {};
    if (this.config.logLevel) {
      getLogger(this.config.logLevel);
    }
    if (this.config.statelog) {
      this.statelogClient = getStatelogClient(this.config.statelog as any);
    }
  }

  protected getAbortSignal(
    promptConfig: PromptConfig,
  ): AbortSignal | undefined {
    return promptConfig.abortSignal;
  }

  protected isAbortError(err: unknown): boolean {
    return (
      (err instanceof DOMException && err.name === "AbortError") ||
      (err instanceof DOMException && err.name === "TimeoutError") ||
      (err instanceof Error && err.name === "AbortError") ||
      (err instanceof Error && err.name === "TimeoutError")
    );
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
      this.statelogClient?.debug("Message limit exceeded", {
        messageCount: promptConfig.messages.length,
        maxMessages: promptConfig.maxMessages,
      });
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
    const startTime = performance.now();
    try {
      const result = await this.textWithRetry(
        newPromptConfig,
        newPromptConfig.responseFormatOptions?.numRetries ||
          DEFAULT_NUM_RETRIES,
      );
      this.recordLatency(startTime, result);
      return result;
    } catch (err) {
      if (this.isAbortError(err)) {
        this.statelogClient?.debug("Request aborted or timed out", {
          reason: "Request was aborted",
          promptConfig,
        });
        return { success: false, error: "Request was aborted" };
      }
      throw err;
    }
  }

  checkForToolLoops(promptConfig: PromptConfig): {
    continue: boolean;
    newPromptConfig: PromptConfig;
  } {
    if (!promptConfig.toolLoopDetection?.enabled) {
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
        count >= promptConfig.toolLoopDetection.maxCalls &&
        !(promptConfig.toolLoopDetection.excludeTools ?? []).includes(toolName)
      ) {
        const intervention =
          promptConfig.toolLoopDetection.intervention || "remove-tool";
        const logger = getLogger();
        logger.warn(
          `Tool loop detected for tool "${toolName}" called ${count} times. Intervention: ${intervention}`,
        );
        this.statelogClient?.debug("Tool loop detected", {
          toolName,
          count,
          intervention,
        });
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

  private recordLatency(startTime: number, result: Result<PromptResult>): void {
    if (!result.success) return;
    const outputTokens = result.value.usage?.outputTokens;
    if (!outputTokens || outputTokens <= 0) return;
    const elapsedMs = performance.now() - startTime;
    latencyTracker.record(this.config.model, elapsedMs, outputTokens);
  }

  extractResponse(
    promptConfig: PromptConfig,
    rawValue: any,
    schema: any,
    depth: number = 0,
  ): any {
    const MAX_DEPTH = 5;
    if (depth > MAX_DEPTH) {
      throw new Error("extractResponse exceeded maximum depth");
    }

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
        return this.extractResponse(
          promptConfig,
          JSON.parse(stripped),
          schema,
          depth + 1,
        );
      } catch (err) {
        const logger = getLogger();
        logger.debug("extractResponse: failed to parse JSON from string", {
          error: (err as Error).message,
          rawValue: stripped,
        });
        this.statelogClient?.debug(
          "extractResponse: failed to parse JSON from string",
          { error: (err as Error).message },
        );
      }
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
        if (inner.success) return inner.data;
      }
    }

    // 6. Shallow search — check every value of the object (own keys only)
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
      // If there are tool calls, return them immediately — format validation
      // only applies to the final text output, not intermediate tool-call turns.
      if (result.value.toolCalls.length > 0) {
        return result;
      }

      if (
        !promptConfig.responseFormat ||
        !promptConfig.responseFormatOptions?.strict
      ) {
        return result;
      }

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
          logger.warn(
            `Response format validation failed (retries left: ${retries}): `,
            errorMessage,
          );
          if (err instanceof z.ZodError) {
            logger.warn("Zod error details:", z.prettifyError(err));
          }

          this.statelogClient?.debug("Response format validation failed", {
            retriesLeft: retries,
            error: errorMessage,
          });

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
    const numRetries =
      promptConfig.responseFormatOptions?.numRetries || DEFAULT_NUM_RETRIES;
    throw new SmolStructuredOutputError(
      `Failed to get valid response after ${numRetries} attempts: ${result.success ? "Output did not match expected format" : result.error}`,
    );
  }

  async _textSync(promptConfig: PromptConfig): Promise<Result<PromptResult>> {
    throw new Error("Method not implemented.");
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
    const startTime = performance.now();
    try {
      for await (const chunk of this._textStream(newPromptConfig)) {
        if (chunk.type === "done") {
          const outputTokens = chunk.result.usage?.outputTokens;
          if (outputTokens && outputTokens > 0) {
            const elapsedMs = performance.now() - startTime;
            latencyTracker.record(this.config.model, elapsedMs, outputTokens);
          }
        }
        yield chunk;
      }
    } catch (err) {
      if (this.isAbortError(err)) {
        this.statelogClient?.debug("Streaming request aborted or timed out", {
          reason: "Request was aborted",
          newPromptConfig,
        });
        yield { type: "timeout", error: "Request was aborted" };
      } else {
        throw err;
      }
    }
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
