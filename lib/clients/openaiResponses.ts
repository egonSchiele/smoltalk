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
import { ToolCall } from "../classes/ToolCall.js";
import { getLogger } from "../logger.js";
import { BaseClient } from "./baseClient.js";
import { zodToOpenAIResponsesTool } from "../util/tool.js";
import { calculateCost, ModelName } from "../models.js";
import { CostEstimate, TokenUsage } from "../types.js";
import type {
  ResponseInputItem,
  ResponseStreamEvent,
} from "openai/resources/responses/responses.js";

export type SmolOpenAiResponsesConfig = BaseClientConfig;

export class SmolOpenAiResponses extends BaseClient implements SmolClient {
  private client: OpenAI;
  private logger: EgonLog;
  private model: string;

  constructor(config: SmolOpenAiResponsesConfig) {
    super(config);
    if (!config.openAiApiKey) {
      throw new Error(
        "OpenAI API key is required for SmolOpenAiResponses client.",
      );
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

  private convertMessages(config: PromptConfig): {
    instructions: string | undefined;
    input: ResponseInputItem[];
  } {
    let instructions: string | undefined = config.instructions;
    const input: ResponseInputItem[] = [];

    config.messages.forEach((msg, i) => {
      if (
        (msg.role === "system" || msg.role === "developer") &&
        !instructions
      ) {
        // First system/developer message becomes instructions
        instructions = msg.content;
        return; // Don't include this message in the input
      }

      // Use the message's toOpenAIResponseInputItem method
      const items = msg.toOpenAIResponseInputItem();
      if (Array.isArray(items)) {
        input.push(...items);
      } else {
        input.push(items);
      }
    });

    return { instructions, input };
  }

  private buildRequest(config: PromptConfig) {
    const { instructions, input } = this.convertMessages(config);

    const request: Record<string, any> = {
      model: this.model,
      input,
    };

    if (instructions) {
      request.instructions = instructions;
    }

    if (config.tools && config.tools.length > 0) {
      request.tools = config.tools.map((tool) =>
        zodToOpenAIResponsesTool(tool.name, tool.schema, {
          description: tool.description,
        }),
      );
    }

    if (config.temperature !== undefined) {
      request.temperature = config.temperature;
    }

    if (config.maxTokens !== undefined) {
      request.max_output_tokens = config.maxTokens;
    }

    if (config.parallelToolCalls !== undefined) {
      request.parallel_tool_calls = config.parallelToolCalls;
    }

    if (config.responseFormat) {
      request.text = {
        format: {
          type: "json_schema",
          name: config.responseFormatOptions?.name || "response",
          schema: config.responseFormat.toJSONSchema(),
        },
      };
    }

    if (config.rawAttributes) {
      Object.assign(request, config.rawAttributes);
    }

    return request;
  }

  private calculateUsageAndCost(usageData: any): {
    usage?: TokenUsage;
    cost?: CostEstimate;
  } {
    let usage: TokenUsage | undefined;
    let cost: CostEstimate | undefined;

    if (usageData) {
      usage = {
        inputTokens: usageData.input_tokens || 0,
        outputTokens: usageData.output_tokens || 0,
        cachedInputTokens: usageData.input_tokens_details?.cached_tokens,
        totalTokens: usageData.total_tokens,
      };

      const calculatedCost = calculateCost(this.model as ModelName, usage);
      if (calculatedCost) {
        cost = calculatedCost;
      }
    }

    return { usage, cost };
  }

  async _textSync(config: PromptConfig): Promise<Result<PromptResult>> {
    const request = this.buildRequest(config);

    this.logger.debug(
      "Sending request to OpenAI Responses API:",
      JSON.stringify(request, null, 2),
    );

    const response = await this.client.responses.create({
      ...request,
      stream: false,
    });

    this.logger.debug(
      "Response from OpenAI Responses API:",
      JSON.stringify(response, null, 2),
    );

    const output = response.output_text || null;

    const toolCalls: ToolCall[] = [];
    for (const item of response.output) {
      if (item.type === "function_call") {
        toolCalls.push(new ToolCall(item.call_id, item.name, item.arguments));
      }
    }

    const { usage, cost } = this.calculateUsageAndCost(response.usage);

    return success({ output, toolCalls, usage, cost });
  }

  async *_textStream(config: PromptConfig): AsyncGenerator<StreamChunk> {
    const request = this.buildRequest(config);

    this.logger.debug(
      "Sending streaming request to OpenAI Responses API:",
      JSON.stringify(request, null, 2),
    );

    const stream = this.client.responses.stream(request);

    let content = "";
    const functionCalls = new Map<
      string,
      { name: string; arguments: string; call_id: string }
    >();
    let usage: TokenUsage | undefined;
    let cost: CostEstimate | undefined;

    for await (const event of stream as AsyncIterable<ResponseStreamEvent>) {
      switch (event.type) {
        case "response.output_text.delta": {
          content += event.delta;
          yield { type: "text", text: event.delta };
          break;
        }

        case "response.function_call_arguments.delta": {
          const existing = functionCalls.get(event.item_id);
          if (existing) {
            existing.arguments += event.delta;
          } else {
            functionCalls.set(event.item_id, {
              name: "",
              arguments: event.delta,
              call_id: "",
            });
          }
          break;
        }

        case "response.function_call_arguments.done": {
          const entry = functionCalls.get(event.item_id);
          if (entry) {
            entry.arguments = event.arguments;
            entry.name = event.name;
          } else {
            functionCalls.set(event.item_id, {
              name: event.name,
              arguments: event.arguments,
              call_id: "",
            });
          }
          break;
        }

        case "response.output_item.done": {
          if (event.item.type === "function_call") {
            const entry = functionCalls.get(event.item.id!);
            if (entry) {
              entry.call_id = event.item.call_id;
              entry.name = event.item.name;
            } else {
              functionCalls.set(event.item.id!, {
                name: event.item.name,
                arguments: event.item.arguments,
                call_id: event.item.call_id,
              });
            }
          }
          break;
        }

        case "response.completed": {
          const usageAndCost = this.calculateUsageAndCost(event.response.usage);
          usage = usageAndCost.usage;
          cost = usageAndCost.cost;
          break;
        }
      }
    }

    this.logger.debug("Streaming response completed from OpenAI Responses API");

    const toolCalls: ToolCall[] = [];
    for (const fc of functionCalls.values()) {
      const toolCall = new ToolCall(fc.call_id, fc.name, fc.arguments);
      toolCalls.push(toolCall);
      yield { type: "tool_call", toolCall };
    }

    yield {
      type: "done",
      result: { output: content || null, toolCalls, usage, cost },
    };
  }
}
