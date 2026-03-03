import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages.js";
import { EgonLog } from "egonlog";
import { ToolCall } from "../classes/ToolCall.js";
import {
  SystemMessage,
  DeveloperMessage,
} from "../classes/message/index.js";
import { getLogger } from "../logger.js";
import {
  BaseClientConfig,
  CostEstimate,
  PromptConfig,
  PromptResult,
  Result,
  SmolClient,
  StreamChunk,
  ThinkingBlock,
  TokenUsage,
  success,
} from "../types.js";
import { zodToAnthropicTool } from "../util/tool.js";
import { BaseClient } from "./baseClient.js";
import { calculateCost, ModelName } from "../models.js";

const DEFAULT_MAX_TOKENS = 4096;

export type SmolAnthropicConfig = BaseClientConfig & {
  anthropicApiKey: string;
};

export class SmolAnthropic extends BaseClient implements SmolClient {
  private client: Anthropic;
  private logger: EgonLog;
  private model: string;

  constructor(config: SmolAnthropicConfig) {
    super(config);
    this.client = new Anthropic({ apiKey: config.anthropicApiKey });
    this.logger = getLogger();
    this.model = config.model;
  }

  getModel() {
    return this.model;
  }

  private calculateUsageAndCost(usageData: {
    input_tokens: number;
    output_tokens: number;
  }): { usage?: TokenUsage; cost?: CostEstimate } {
    const usage: TokenUsage = {
      inputTokens: usageData.input_tokens,
      outputTokens: usageData.output_tokens,
      totalTokens: usageData.input_tokens + usageData.output_tokens,
    };
    const cost = calculateCost(this.model as ModelName, usage) ?? undefined;
    return { usage, cost };
  }

  private buildRequest(config: PromptConfig): {
    system: string | undefined;
    messages: MessageParam[];
    tools: Tool[] | undefined;
    thinking: { type: "enabled"; budget_tokens: number } | undefined;
  } {
    // Split system/developer messages out into the top-level `system` param
    const systemParts = config.messages
      .filter(
        (m) => m instanceof SystemMessage || m instanceof DeveloperMessage
      )
      .map((m) => m.content);

    const system =
      systemParts.length > 0 ? systemParts.join("\n") : undefined;

    // Convert remaining messages, merging consecutive tool_result user messages
    const anthropicMessages: MessageParam[] = [];
    for (const msg of config.messages) {
      if (msg instanceof SystemMessage || msg instanceof DeveloperMessage) {
        continue;
      }

      const converted = msg.toAnthropicMessage();
      if (converted === null) continue;

      // Merge consecutive tool_result user messages into one (required by Anthropic)
      if (
        converted.role === "user" &&
        Array.isArray(converted.content) &&
        (converted.content as any[]).every(
          (c: any) => c.type === "tool_result"
        )
      ) {
        const last = anthropicMessages[anthropicMessages.length - 1];
        if (
          last &&
          last.role === "user" &&
          Array.isArray(last.content) &&
          (last.content as any[]).every((c: any) => c.type === "tool_result")
        ) {
          (last.content as any[]).push(...(converted.content as any[]));
          continue;
        }
      }

      anthropicMessages.push(converted as MessageParam);
    }

    const tools =
      config.tools && config.tools.length > 0
        ? (config.tools.map((tool) =>
            zodToAnthropicTool(tool.name, tool.schema, {
              description: tool.description,
            })
          ) as Tool[])
        : undefined;

    const reasoningBudgetMap = { low: 2048, medium: 5000, high: 10000 } as const;

    const thinking =
      config.thinking?.enabled
        ? { type: "enabled" as const, budget_tokens: config.thinking.budgetTokens ?? 5000 }
        : config.reasoningEffort
          ? { type: "enabled" as const, budget_tokens: reasoningBudgetMap[config.reasoningEffort] }
          : undefined;

    return { system, messages: anthropicMessages, tools, thinking };
  }

  async _textSync(config: PromptConfig): Promise<Result<PromptResult>> {
    const { system, messages, tools, thinking } = this.buildRequest(config);

    this.logger.debug("Sending request to Anthropic:", {
      model: this.model,
      max_tokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages,
      system,
      tools,
      thinking,
    });

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages,
      ...(system && { system }),
      ...(tools && { tools }),
      ...(thinking && { thinking }),
      ...(config.temperature !== undefined && {
        temperature: config.temperature,
      }),
      ...(config.rawAttributes || {}),
      stream: false,
    } as any);

    this.logger.debug("Response from Anthropic:", response);

    let output: string | null = null;
    const toolCalls: ToolCall[] = [];
    const thinkingBlocks: ThinkingBlock[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        output = (output ?? "") + block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push(
          new ToolCall(block.id, block.name, block.input as Record<string, any>)
        );
      } else if ((block as any).type === "thinking") {
        const b = block as any;
        thinkingBlocks.push({ text: b.thinking, signature: b.signature });
      }
    }

    const { usage, cost } = this.calculateUsageAndCost(response.usage);

    return success({
      output,
      toolCalls,
      ...(thinkingBlocks.length > 0 && { thinkingBlocks }),
      usage,
      cost,
      model: this.model as ModelName,
    });
  }

  async *_textStream(config: PromptConfig): AsyncGenerator<StreamChunk> {
    const { system, messages, tools, thinking } = this.buildRequest(config);

    this.logger.debug("Sending streaming request to Anthropic:", {
      model: this.model,
      max_tokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages,
      system,
      tools,
      thinking,
    });

    const stream = await this.client.messages.create({
      model: this.model,
      max_tokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages,
      ...(system && { system }),
      ...(tools && { tools }),
      ...(thinking && { thinking }),
      ...(config.temperature !== undefined && {
        temperature: config.temperature,
      }),
      ...(config.rawAttributes || {}),
      stream: true,
    } as any);

    let content = "";
    // Track tool blocks by index: index -> { id, name, arguments (partial JSON) }
    const toolBlocks = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();
    // Track thinking blocks by index: index -> { text, signature }
    const thinkingBlockMap = new Map<
      number,
      { text: string; signature: string }
    >();
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const event of stream as any) {
      if (event.type === "message_start") {
        inputTokens = event.message.usage.input_tokens;
      } else if (event.type === "content_block_start") {
        if (event.content_block.type === "tool_use") {
          toolBlocks.set(event.index, {
            id: event.content_block.id,
            name: event.content_block.name,
            arguments: "",
          });
        } else if (event.content_block.type === "thinking") {
          thinkingBlockMap.set(event.index, { text: "", signature: "" });
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          content += event.delta.text;
          yield { type: "text", text: event.delta.text };
        } else if (event.delta.type === "input_json_delta") {
          const block = toolBlocks.get(event.index);
          if (block) {
            block.arguments += event.delta.partial_json;
          }
        } else if (event.delta.type === "thinking_delta") {
          const block = thinkingBlockMap.get(event.index);
          if (block) {
            block.text += event.delta.thinking;
          }
        } else if (event.delta.type === "signature_delta") {
          const block = thinkingBlockMap.get(event.index);
          if (block) {
            block.signature = event.delta.signature;
          }
        }
      } else if (event.type === "content_block_stop") {
        // Emit thinking chunk once the block is fully assembled
        const thinkingBlock = thinkingBlockMap.get(event.index);
        if (thinkingBlock) {
          yield { type: "thinking", text: thinkingBlock.text, signature: thinkingBlock.signature };
        }
      } else if (event.type === "message_delta") {
        outputTokens = event.usage.output_tokens;
      }
    }

    this.logger.debug("Streaming response completed from Anthropic");

    const toolCalls: ToolCall[] = [];
    for (const block of toolBlocks.values()) {
      const toolCall = new ToolCall(block.id, block.name, block.arguments);
      toolCalls.push(toolCall);
      yield { type: "tool_call", toolCall };
    }

    const thinkingBlocks: ThinkingBlock[] = Array.from(thinkingBlockMap.values());

    const usage: TokenUsage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    };
    const cost = calculateCost(this.model as ModelName, usage) ?? undefined;

    yield {
      type: "done",
      result: {
        output: content || null,
        toolCalls,
        ...(thinkingBlocks.length > 0 && { thinkingBlocks }),
        usage,
        cost,
        model: this.model as ModelName,
      },
    };
  }
}
