import OpenAI from "openai";
import {
  PromptResult,
  Result,
  SmolClient,
  SmolConfig,
  StreamChunk,
  success,
} from "../types.js";
import { EgonLog } from "../util/logger.js";
import {
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from "openai/resources";
import { ToolCall } from "../classes/ToolCall.js";
import { isFunctionToolCall, sanitizeAttributes } from "../util/util.js";
import { getLogger } from "../util/logger.js";
import { BaseClient } from "./baseClient.js";
import {
  SmolContentPolicyError,
  SmolContextWindowExceededError,
  smolErrorForStatus,
} from "../smolError.js";
import { extractHttpErrorFields } from "../util/httpError.js";
import { zodToOpenAITool } from "../util/tool.js";
import { ModelName } from "../models.js";
import { Model } from "../model.js";
import { CostEstimate, TokenUsage } from "../types.js";

export type SmolOpenAiConfig = SmolConfig;

export class SmolOpenAi extends BaseClient implements SmolClient {
  private client: OpenAI;
  private logger: EgonLog;
  private model: Model;
  constructor(config: SmolOpenAiConfig) {
    super(config);
    if (!config.openAiApiKey) {
      throw new Error("OpenAI API key is required for SmolOpenAi client.");
    }
    this.client = new OpenAI({ apiKey: config.openAiApiKey });
    this.logger = getLogger();
    this.model = new Model(config.model, undefined, config.modelData);
  }

  getClient() {
    return this.client;
  }

  getModel(): ModelName {
    return this.model.getModel();
  }

  private calculateUsageAndCost(usageData: any): {
    usage?: TokenUsage;
    cost?: CostEstimate;
  } {
    let usage: TokenUsage | undefined;
    let cost: CostEstimate | undefined;

    if (usageData) {
      const cached = usageData.prompt_tokens_details?.cached_tokens ?? 0;
      usage = {
        inputTokens: Math.max(0, (usageData.prompt_tokens || 0) - cached),
        outputTokens: usageData.completion_tokens || 0,
        totalTokens: usageData.total_tokens,
      };
      if (cached > 0) {
        usage.cachedInputTokens = cached;
      }

      const calculatedCost = this.model.calculateCost(usage);
      if (calculatedCost) {
        cost = calculatedCost;
      }
    }

    return { usage, cost };
  }

  private buildRequest(config: SmolConfig) {
    const messages = config.messages.map((msg) => msg.toOpenAIMessage());
    const request = {
      model: this.getModel(),
      messages,
      tools: config.tools?.map((tool) => {
        return zodToOpenAITool(tool.name, tool.schema, {
          description: tool.description,
        });
      }),
      ...(config.reasoningEffort && {
        reasoning_effort: config.reasoningEffort,
      }),
      ...sanitizeAttributes(config.rawAttributes),
    };
    if (config.responseFormat) {
      (request as any).response_format = {
        type: "json_schema",

        json_schema: {
          name: config.responseFormatOptions?.name || "response",
          schema: config.responseFormat.toJSONSchema(),
        },
      };
    }
    return request;
  }

  private rethrowAsSmolError(error: unknown): never {
    if (error instanceof OpenAI.APIError) {
      const http = { ...extractHttpErrorFields(error), cause: error };
      if (error.code === "context_length_exceeded") {
        throw new SmolContextWindowExceededError(error.message, http);
      }
      if (error.code === "content_policy_violation") {
        throw new SmolContentPolicyError(error.message, http);
      }
      throw smolErrorForStatus(error.message, http);
    }
    throw error;
  }

  async _textSync(config: SmolConfig): Promise<Result<PromptResult>> {
    const request = this.buildRequest(config);

    this.logger.debug(
      "Sending request to OpenAI:",
      JSON.stringify(request, null, 2),
    );
    this.statelogClient?.promptRequest(request);

    const signal = this.getAbortSignal(config);
    let completion;
    try {
      completion = await this.client.chat.completions.create(
        {
          ...request,
          stream: false as const,
        },
        { ...(signal && { signal }) },
      );
    } catch (error) {
      this.rethrowAsSmolError(error);
    }

    this.logger.debug(
      "Response from OpenAI:",
      JSON.stringify(completion, null, 2),
    );
    this.statelogClient?.promptResponse(completion as any);

    if (completion.choices[0]?.finish_reason === "content_filter") {
      throw new SmolContentPolicyError(
        "Content blocked by OpenAI content filter",
      );
    }

    const message: ChatCompletionMessage = completion.choices[0].message;
    const output = message.content;
    const _toolCalls: ChatCompletionMessageToolCall[] | undefined =
      message.tool_calls;

    const toolCalls: ToolCall[] = [];

    if (_toolCalls) {
      for (const tc of _toolCalls) {
        if (isFunctionToolCall(tc)) {
          toolCalls.push(
            new ToolCall(tc.id, tc.function.name, tc.function.arguments),
          );
        } else {
          this.logger.warn(
            `Unsupported tool call type: ${tc.type} for tool call ID: ${tc.id}`,
          );
          this.statelogClient?.debug(`Unsupported tool call type: ${tc.type}`, {
            toolCallId: tc.id,
          });
        }
      }
    }

    // Extract usage and calculate cost
    const { usage, cost } = this.calculateUsageAndCost(completion.usage);

    return success({
      output,
      toolCalls,
      usage,
      cost,
      model: this.getModel(),
    });
  }

  async *_textStream(config: SmolConfig): AsyncGenerator<StreamChunk> {
    const request = this.buildRequest(config);

    this.logger.debug(
      "Sending streaming request to OpenAI:",
      JSON.stringify(request, null, 2),
    );
    this.statelogClient?.promptRequest(request);

    const signal = this.getAbortSignal(config);
    let completion;
    try {
      completion = await this.client.chat.completions.create(
        {
          ...request,
          stream: true as const,
          stream_options: { include_usage: true },
        },
        { ...(signal && { signal }) },
      );
    } catch (error) {
      this.rethrowAsSmolError(error);
    }

    let content = "";
    const toolCallsMap = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();
    let usage: TokenUsage | undefined;
    let cost: CostEstimate | undefined;

    for await (const chunk of completion) {
      // Extract usage from the final chunk
      if (chunk.usage) {
        const usageAndCost = this.calculateUsageAndCost(chunk.usage);
        usage = usageAndCost.usage;
        cost = usageAndCost.cost;
      }

      if (!chunk.choices || chunk.choices.length === 0) continue;
      if (chunk.choices[0]?.finish_reason === "content_filter") {
        throw new SmolContentPolicyError(
          "Content blocked by OpenAI content filter",
        );
      }
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        content += delta.content;
        yield { type: "text", text: delta.content };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const index = tc.index;
          if (!toolCallsMap.has(index)) {
            toolCallsMap.set(index, {
              id: tc.id || "",
              name: tc.function?.name || "",
              arguments: tc.function?.arguments || "",
            });
          } else {
            const existing = toolCallsMap.get(index)!;
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments)
              existing.arguments += tc.function.arguments;
          }
        }
      }
    }

    this.logger.debug("Streaming response completed from OpenAI");
    this.statelogClient?.promptResponse({ content, usage, cost });

    const toolCalls: ToolCall[] = [];
    for (const tc of toolCallsMap.values()) {
      const toolCall = new ToolCall(tc.id, tc.name, tc.arguments);
      toolCalls.push(toolCall);
      yield { type: "tool_call", toolCall };
    }

    yield {
      type: "done",
      result: {
        output: content || null,
        toolCalls,
        usage,
        cost,
        model: this.getModel(),
      },
    };
  }
}
