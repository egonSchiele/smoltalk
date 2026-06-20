import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages.js";
import { EgonLog } from "../util/logger.js";
import { ToolCall } from "../classes/ToolCall.js";
import { SystemMessage, DeveloperMessage } from "../classes/message/index.js";
import { getLogger } from "../util/logger.js";
import {
  CostEstimate,
  PromptResult,
  Result,
  SmolClient,
  SmolConfig,
  StreamChunk,
  ThinkingBlock,
  TokenUsage,
  success,
} from "../types.js";
import { zodToAnthropicTool } from "../util/tool.js";
import {
  SmolContentPolicyError,
  SmolContextWindowExceededError,
} from "../smolError.js";
import { BaseClient } from "./baseClient.js";
import { ModelName, TextModelName, getModel, isTextModel } from "../models.js";
import { Model } from "../model.js";

const DEFAULT_MAX_TOKENS = 4096;

type EphemeralCacheControl = { type: "ephemeral" };
type SystemBlock = {
  type: "text";
  text: string;
  cache_control?: EphemeralCacheControl;
};
type AnthropicRequestShape = {
  system: string | SystemBlock[] | undefined;
  messages: MessageParam[];
  tools: Tool[] | undefined;
};

/** Legacy thinking shape — `budget_tokens` (Haiku 4.5 and older models). */
type BudgetThinking = { type: "enabled"; budget_tokens: number };
/** Modern thinking shape — Opus 4.6/4.7/4.8, Sonnet 4.6. */
type AdaptiveThinking = { type: "adaptive" };
type ThinkingParam = BudgetThinking | AdaptiveThinking;
/** Effort level for adaptive thinking, passed via Anthropic's `output_config`. */
type OutputConfig = { effort: "low" | "medium" | "high" };

/**
 * Which thinking API a model speaks. New flagship Anthropic models (Opus 4.7+)
 * reject the legacy `{type: "enabled", budget_tokens}` form with a 400, so we
 * default unknown/unregistered models to "adaptive" (the forward-looking shape)
 * rather than the form that's being phased out.
 */
function thinkingStyleFor(modelName: ModelName): "adaptive" | "budget" {
  const model = getModel(modelName);
  if (model && isTextModel(model) && model.reasoning?.thinkingStyle) {
    return model.reasoning.thinkingStyle;
  }
  return "adaptive";
}

/**
 * Attach ephemeral cache_control breakpoints to (up to) three places:
 *   1. the last tool definition
 *   2. the last system block (promoting system from string to array form)
 *   3. the last block of the last user message
 *
 * Anthropic enforces minimum prefix sizes; smaller prefixes silently no-op.
 */
function applyCacheBreakpoints(
  req: AnthropicRequestShape,
): AnthropicRequestShape {
  const cc: EphemeralCacheControl = { type: "ephemeral" };

  // Tools: mark the last tool.
  let tools = req.tools;
  if (tools && tools.length > 0) {
    const lastIdx = tools.length - 1;
    const marked: Tool[] = [];
    for (let i = 0; i < tools.length; i++) {
      if (i === lastIdx) {
        marked.push({ ...tools[i], cache_control: cc } as Tool);
      } else {
        marked.push(tools[i]);
      }
    }
    tools = marked;
  }

  // System: promote string to array form so the last block can be marked.
  let system: string | SystemBlock[] | undefined = req.system;
  if (typeof system === "string" && system.length > 0) {
    system = [{ type: "text", text: system, cache_control: cc }];
  } else if (Array.isArray(system) && system.length > 0) {
    const lastIdx = system.length - 1;
    const marked: SystemBlock[] = [];
    for (let i = 0; i < system.length; i++) {
      if (i === lastIdx) {
        marked.push({ ...system[i], cache_control: cc });
      } else {
        marked.push(system[i]);
      }
    }
    system = marked;
  }

  // Messages: mark the last block of the last user message.
  let messages = req.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;

    let blocks: any[];
    if (typeof m.content === "string") {
      blocks = [{ type: "text", text: m.content }];
    } else {
      blocks = [...(m.content as any[])];
    }
    if (blocks.length === 0) break;

    blocks[blocks.length - 1] = {
      ...blocks[blocks.length - 1],
      cache_control: cc,
    };

    const rebuilt: MessageParam[] = [];
    for (let j = 0; j < messages.length; j++) {
      if (j === i) {
        rebuilt.push({ ...m, content: blocks } as MessageParam);
      } else {
        rebuilt.push(messages[j]);
      }
    }
    messages = rebuilt;
    break;
  }

  return { system, messages, tools };
}

export type SmolAnthropicConfig = SmolConfig & {
  anthropicApiKey: string;
};

export class SmolAnthropic extends BaseClient implements SmolClient {
  private client: Anthropic;
  private logger: EgonLog;
  private model: Model;

  constructor(config: SmolAnthropicConfig) {
    super(config);
    this.client = new Anthropic({ apiKey: config.anthropicApiKey });
    this.logger = getLogger();
    this.model = new Model(config.model);
  }

  getModel(): ModelName {
    return this.model.getModel();
  }

  private calculateUsageAndCost(usageData: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  }): { usage?: TokenUsage; cost?: CostEstimate } {
    const cacheRead = usageData.cache_read_input_tokens ?? 0;
    const cacheCreation = usageData.cache_creation_input_tokens ?? 0;
    const usage: TokenUsage = {
      inputTokens: usageData.input_tokens,
      outputTokens: usageData.output_tokens,
      totalTokens:
        usageData.input_tokens +
        cacheRead +
        cacheCreation +
        usageData.output_tokens,
    };
    if (cacheRead > 0) {
      usage.cachedInputTokens = cacheRead;
    }
    if (cacheCreation > 0) {
      usage.cacheCreationInputTokens = cacheCreation;
    }
    const cost = this.model.calculateCost(usage) ?? undefined;
    return { usage, cost };
  }

  private buildRequest(config: SmolConfig): {
    system: string | SystemBlock[] | undefined;
    messages: MessageParam[];
    tools: Tool[] | undefined;
    thinking: ThinkingParam | undefined;
    outputConfig: OutputConfig | undefined;
  } {
    // Split system/developer messages out into the top-level `system` param
    const systemParts = config.messages
      .filter(
        (m) => m instanceof SystemMessage || m instanceof DeveloperMessage,
      )
      .map((m) => m.content);

    const system = systemParts.length > 0 ? systemParts.join("\n") : undefined;

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
        (converted.content as any[]).every((c: any) => c.type === "tool_result")
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
            }),
          ) as Tool[])
        : undefined;

    // Normalize the user's provider-agnostic thinking/effort config into the
    // shape this specific model accepts. Both `thinking.enabled` and
    // `reasoningEffort` are treated as a request to think.
    const { thinking, outputConfig } = this.resolveThinking(config);

    const cachingEnabled = config.caching?.enabled !== false;
    const baseRequest = { system, messages: anthropicMessages, tools };
    const finalRequest = cachingEnabled
      ? applyCacheBreakpoints(baseRequest)
      : baseRequest;

    return { ...finalRequest, thinking, outputConfig };
  }

  /**
   * Translate `thinking` / `reasoningEffort` into the correct Anthropic
   * parameters for this model. Callers shouldn't have to know whether a model
   * speaks the legacy `budget_tokens` API or the newer adaptive + effort API —
   * that's exactly the vendor difference this package smooths over.
   */
  private resolveThinking(config: SmolConfig): {
    thinking: ThinkingParam | undefined;
    outputConfig: OutputConfig | undefined;
  } {
    const wantsThinking = config.thinking?.enabled === true;
    const effort = config.reasoningEffort;

    if (!wantsThinking && !effort) {
      return { thinking: undefined, outputConfig: undefined };
    }

    if (thinkingStyleFor(this.getModel()) === "adaptive") {
      // `output_config.effort` controls depth; the budget is irrelevant here.
      return {
        thinking: { type: "adaptive" },
        outputConfig: effort ? { effort } : undefined,
      };
    }

    // Legacy budget-based thinking (Haiku 4.5 and older models).
    const reasoningBudgetMap = {
      low: 2048,
      medium: 5000,
      high: 10000,
    } as const;
    const budget_tokens = wantsThinking
      ? (config.thinking?.budgetTokens ?? 5000)
      : reasoningBudgetMap[effort!];

    return {
      thinking: { type: "enabled", budget_tokens },
      outputConfig: undefined,
    };
  }

  private rethrowAsSmolError(error: unknown): never {
    if (error instanceof Anthropic.APIError) {
      const msg = error.message.toLowerCase();
      if (
        msg.includes("prompt is too long") ||
        msg.includes("context length") ||
        msg.includes("context window") ||
        msg.includes("too many tokens")
      ) {
        throw new SmolContextWindowExceededError(error.message);
      }
      if (
        msg.includes("content policy") ||
        msg.includes("usage policies") ||
        msg.includes("content filtering") ||
        msg.includes("violates our")
      ) {
        throw new SmolContentPolicyError(error.message);
      }
    }
    throw error;
  }

  async _textSync(config: SmolConfig): Promise<Result<PromptResult>> {
    const { system, messages, tools, thinking, outputConfig } =
      this.buildRequest(config);

    let debugData = {
      model: this.getModel(),
      max_tokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages,
      system,
      tools,
      thinking,
      output_config: outputConfig,
    };
    this.logger.debug("Sending request to Anthropic:", debugData);
    this.statelogClient?.promptRequest(debugData);

    const signal = this.getAbortSignal(config);
    let response;
    try {
      response = await this.client.messages.create(
        {
          model: this.getModel(),
          max_tokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
          messages,
          ...(system && { system }),
          ...(tools && { tools }),
          ...(thinking && { thinking }),
          ...(outputConfig && { output_config: outputConfig }),
          ...(config.temperature !== undefined && {
            temperature: config.temperature,
          }),
          ...(config.rawAttributes || {}),
          stream: false,
        } as any,
        { ...(signal && { signal }) },
      );
    } catch (error) {
      this.rethrowAsSmolError(error);
    }

    this.logger.debug("Response from Anthropic:", response);
    this.statelogClient?.promptResponse(response);

    let output: string | null = null;
    const toolCalls: ToolCall[] = [];
    const thinkingBlocks: ThinkingBlock[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        output = (output ?? "") + block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push(
          new ToolCall(
            block.id,
            block.name,
            block.input as Record<string, any>,
          ),
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
      model: this.getModel(),
    });
  }

  async *_textStream(config: SmolConfig): AsyncGenerator<StreamChunk> {
    const { system, messages, tools, thinking, outputConfig } =
      this.buildRequest(config);

    const streamDebugData = {
      model: this.model,
      max_tokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages,
      system,
      tools,
      thinking,
      output_config: outputConfig,
    };
    this.logger.debug(
      "Sending streaming request to Anthropic:",
      streamDebugData,
    );
    this.statelogClient?.promptRequest(streamDebugData);

    const signal = this.getAbortSignal(config);
    let stream;
    try {
      stream = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
          messages,
          ...(system && { system }),
          ...(tools && { tools }),
          ...(thinking && { thinking }),
          ...(outputConfig && { output_config: outputConfig }),
          ...(config.temperature !== undefined && {
            temperature: config.temperature,
          }),
          ...(config.rawAttributes || {}),
          stream: true,
        } as any,
        { ...(signal && { signal }) },
      );
    } catch (error) {
      this.rethrowAsSmolError(error);
    }

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
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    let outputTokens = 0;

    for await (const event of stream as any) {
      if (event.type === "message_start") {
        const u = event.message.usage;
        inputTokens = u.input_tokens;
        cacheReadTokens = u.cache_read_input_tokens ?? 0;
        cacheCreationTokens = u.cache_creation_input_tokens ?? 0;
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
          yield {
            type: "thinking",
            text: thinkingBlock.text,
            signature: thinkingBlock.signature,
          };
        }
      } else if (event.type === "message_delta") {
        outputTokens = event.usage.output_tokens;
        // Defensive: in practice Anthropic only sends cache fields on
        // message_start, but read them here too so we don't miss an
        // update if the SDK changes.
        if (event.usage.cache_read_input_tokens != null) {
          cacheReadTokens = event.usage.cache_read_input_tokens;
        }
        if (event.usage.cache_creation_input_tokens != null) {
          cacheCreationTokens = event.usage.cache_creation_input_tokens;
        }
      }
    }

    this.logger.debug("Streaming response completed from Anthropic");
    this.statelogClient?.promptResponse({
      content,
      usage: { inputTokens, outputTokens },
    });

    const toolCalls: ToolCall[] = [];
    for (const block of toolBlocks.values()) {
      const toolCall = new ToolCall(block.id, block.name, block.arguments);
      toolCalls.push(toolCall);
      yield { type: "tool_call", toolCall };
    }

    const thinkingBlocks: ThinkingBlock[] = Array.from(
      thinkingBlockMap.values(),
    );

    const usage: TokenUsage = {
      inputTokens,
      outputTokens,
      totalTokens:
        inputTokens + cacheReadTokens + cacheCreationTokens + outputTokens,
    };
    if (cacheReadTokens > 0) {
      usage.cachedInputTokens = cacheReadTokens;
    }
    if (cacheCreationTokens > 0) {
      usage.cacheCreationInputTokens = cacheCreationTokens;
    }
    const cost = this.model.calculateCost(usage) ?? undefined;

    yield {
      type: "done",
      result: {
        output: content || null,
        toolCalls,
        ...(thinkingBlocks.length > 0 && { thinkingBlocks }),
        usage,
        cost,
        model: this.getModel(),
      },
    };
  }
}
