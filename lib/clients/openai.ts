import OpenAI from "openai";
import {
  BaseClientConfig,
  PromptConfig,
  PromptResult,
  Result,
  SmolClient,
  StreamChunk,
  success,
} from "../types.js";
import { EgonLog } from "egonlog";
import {
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from "openai/resources";
import { ToolCall } from "../classes/ToolCall.js";
import { isFunctionToolCall } from "../util.js";
import { getLogger } from "../logger.js";
import { BaseClient } from "./baseClient.js";
import { zodToOpenAITool } from "../util/tool.js";
import { calculateCost, ModelName } from "../models.js";
import { CostEstimate, TokenUsage } from "../types.js";

export type SmolOpenAiConfig = BaseClientConfig;

export class SmolOpenAi extends BaseClient implements SmolClient {
  private client: OpenAI;
  private logger: EgonLog;
  private model: string;
  constructor(config: SmolOpenAiConfig) {
    super(config);
    if (!config.openAiApiKey) {
      throw new Error("OpenAI API key is required for SmolOpenAi client.");
    }
    this.client = new OpenAI({ apiKey: config.openAiApiKey });
    this.logger = getLogger();
    this.model = config.model;
  }

  getClient() {
    return this.client;
  }

  getModel() {
    return this.model;
  }

  private calculateUsageAndCost(usageData: any): {
    usage?: TokenUsage;
    cost?: CostEstimate;
  } {
    let usage: TokenUsage | undefined;
    let cost: CostEstimate | undefined;

    if (usageData) {
      usage = {
        inputTokens: usageData.prompt_tokens || 0,
        outputTokens: usageData.completion_tokens || 0,
        cachedInputTokens: usageData.prompt_tokens_details?.cached_tokens,
        totalTokens: usageData.total_tokens,
      };

      const calculatedCost = calculateCost(this.model as ModelName, usage);
      if (calculatedCost) {
        cost = calculatedCost;
      }
    }

    return { usage, cost };
  }

  private buildRequest(config: PromptConfig) {
    const messages = config.messages.map((msg) => msg.toOpenAIMessage());
    const request = {
      model: this.model,
      messages,
      tools: config.tools?.map((tool) => {
        return zodToOpenAITool(tool.name, tool.schema, {
          description: tool.description,
        });
      }),
      ...(config.rawAttributes || {}),
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

  async _textSync(config: PromptConfig): Promise<Result<PromptResult>> {
    const request = this.buildRequest(config);

    this.logger.debug(
      "Sending request to OpenAI:",
      JSON.stringify(request, null, 2),
    );

    const completion = await this.client.chat.completions.create({
      ...request,
      stream: false as const,
    });

    this.logger.debug(
      "Response from OpenAI:",
      JSON.stringify(completion, null, 2),
    );
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
        }
      }
    }

    // Extract usage and calculate cost
    const { usage, cost } = this.calculateUsageAndCost(completion.usage);

    return success({ output, toolCalls, usage, cost });
  }

  async *_textStream(config: PromptConfig): AsyncGenerator<StreamChunk> {
    const request = this.buildRequest(config);

    this.logger.debug(
      "Sending streaming request to OpenAI:",
      JSON.stringify(request, null, 2),
    );

    const completion = await this.client.chat.completions.create({
      ...request,
      stream: true as const,
      stream_options: { include_usage: true },
    });

    let content = "";
    const toolCallsMap = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();
    let usage: TokenUsage | undefined;
    let cost: CostEstimate | undefined;

    for await (const chunk of completion) {
      const delta = chunk.choices[0]?.delta;

      // Extract usage from the final chunk
      if (chunk.usage) {
        const usageAndCost = this.calculateUsageAndCost(chunk.usage);
        usage = usageAndCost.usage;
        cost = usageAndCost.cost;
      }

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

    const toolCalls: ToolCall[] = [];
    for (const tc of toolCallsMap.values()) {
      const toolCall = new ToolCall(tc.id, tc.name, tc.arguments);
      toolCalls.push(toolCall);
      yield { type: "tool_call", toolCall };
    }

    yield {
      type: "done",
      result: { output: content || null, toolCalls, usage, cost },
    };
  }
}
