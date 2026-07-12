import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages.js";
import { EgonLog } from "../util/logger.js";
import { ToolCall } from "../classes/ToolCall.js";
import { SystemMessage, DeveloperMessage } from "../classes/message/index.js";
import { getLogger } from "../util/logger.js";
import { redactAttachments } from "../util/redact.js";
import type { ModelDataBlob } from "../modelData.js";
import {
  CostEstimate,
  PromptResult,
  Result,
  SmolClient,
  SmolConfig,
  StreamChunk,
  ThinkingBlock,
  TokenUsage,
  HostedToolResult,
  WebSearchSource,
  WebSearchCitation,
  success,
} from "../types.js";
import { WEB_SEARCH, webSearchResult, applyHostedToolCost } from "../util/hostedTools.js";
import { zodToAnthropicTool } from "../util/tool.js";
import {
  SmolContentPolicyError,
  SmolContextWindowExceededError,
  smolErrorForStatus,
} from "../smolError.js";
import { extractHttpErrorFields } from "../util/httpError.js";
import { BaseClient } from "./baseClient.js";
import { ModelName, TextModelName, getModel, isTextModel } from "../models.js";
import { Model } from "../model.js";

const DEFAULT_MAX_TOKENS = 4096;

// Normalize an Anthropic message's content to a block array for merging.
// Array content is passed through; a non-empty string becomes a single text
// block; an empty string (or any other unexpected value) becomes no blocks
// (Anthropic rejects empty text blocks). Guarding non-array values keeps the
// exported merge helper from throwing on a spread if a caller passes content
// that isn't the string | block[] the type promises.
function anthropicContentToBlocks(content: string | any[]): any[] {
  if (Array.isArray(content)) {
    return content;
  }
  if (typeof content === "string" && content.length > 0) {
    return [{ type: "text", text: content }];
  }
  return [];
}

// Anthropic requires strict user/assistant turn alternation. Collapse any run of
// consecutive messages that share a role into a single message by concatenating
// their content blocks. Does not mutate the input.
export function mergeConsecutiveMessages(
  messages: MessageParam[],
): MessageParam[] {
  const merged: MessageParam[] = [];
  for (const msg of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === msg.role) {
      const content = [
        ...anthropicContentToBlocks(last.content as any),
        ...anthropicContentToBlocks(msg.content as any),
      ];
      merged[merged.length - 1] = { ...last, content } as MessageParam;
      continue;
    }
    merged.push(msg);
  }
  return merged;
}

export function anthropicWebSearchEntries(hostedTools?: string[]): any[] {
  if (hostedTools && hostedTools.includes(WEB_SEARCH)) {
    return [{ type: "web_search_20250305", name: "web_search" }];
  }
  return [];
}

export function parseAnthropicHostedTools(
  response: any,
  provider: string,
): HostedToolResult[] {
  const queries: string[] = [];
  const sources: WebSearchSource[] = [];
  const citations: WebSearchCitation[] = [];
  const raw: any[] = [];
  for (const block of response.content || []) {
    if (block.type === "server_tool_use" && block.name === "web_search") {
      raw.push(block);
      // input.query is always the search string; guard only against a malformed block.
      if (block.input?.query) {
        queries.push(block.input.query);
      }
    } else if (block.type === "web_search_tool_result") {
      raw.push(block);
      // content items are web_search_result entries; an error variant has no url.
      for (const r of block.content || []) {
        if (r && typeof r.url === "string") {
          sources.push({ url: r.url, title: r.title });
        }
      }
    } else if (block.type === "text" && Array.isArray(block.citations)) {
      for (const c of block.citations) {
        if (c && typeof c.url === "string") {
          citations.push({ url: c.url, title: c.title });
        }
      }
    }
  }
  const callCount = response.usage?.server_tool_use?.web_search_requests;
  const used = queries.length > 0 || sources.length > 0 || (callCount ?? 0) > 0;
  if (!used) {
    return [];
  }
  return [webSearchResult(provider, { queries, sources, citations, callCount, raw })];
}

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
function thinkingStyleFor(
  modelName: ModelName,
  modelData?: ModelDataBlob,
): "adaptive" | "budget" {
  const model = getModel(modelName, modelData);
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
export function applyCacheBreakpoints(
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

export type SmolAnthropicConfig = SmolConfig;

export class SmolAnthropic extends BaseClient implements SmolClient {
  private client: Anthropic;
  private logger: EgonLog;
  private model: Model;

  constructor(config: SmolAnthropicConfig) {
    super(config);
    const apiKey = config.apiKey?.anthropic || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("Anthropic API key is required for SmolAnthropic client.");
    }
    this.client = new Anthropic({ apiKey });
    this.logger = getLogger();
    this.model = new Model(config.model, undefined, config.modelData);
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

    // Convert remaining messages into Anthropic message params.
    const converted: MessageParam[] = [];
    for (const msg of config.messages) {
      if (msg instanceof SystemMessage || msg instanceof DeveloperMessage) {
        continue;
      }

      const c = msg.toAnthropicMessage();
      if (c === null) continue;
      converted.push(c as MessageParam);
    }

    // Anthropic requires strict user/assistant alternation — merge any run of
    // consecutive same-role messages into one (e.g. two user turns, or a user
    // turn followed by tool results, which also map to role "user").
    const anthropicMessages = mergeConsecutiveMessages(converted);

    const functionTools =
      config.tools && config.tools.length > 0
        ? (config.tools.map((tool) =>
            zodToAnthropicTool(tool.name, tool.schema, {
              description: tool.description,
            }),
          ) as Tool[])
        : [];
    const hostedEntries = anthropicWebSearchEntries(config.hostedTools);
    const allTools = [...functionTools, ...hostedEntries] as Tool[];
    const tools = allTools.length > 0 ? allTools : undefined;

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

    if (thinkingStyleFor(this.getModel(), this.config.modelData) === "adaptive") {
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
      const http = { ...extractHttpErrorFields(error), cause: error };
      const msg = error.message.toLowerCase();
      if (
        msg.includes("prompt is too long") ||
        msg.includes("context length") ||
        msg.includes("context window") ||
        msg.includes("too many tokens")
      ) {
        throw new SmolContextWindowExceededError(error.message, http);
      }
      if (
        msg.includes("content policy") ||
        msg.includes("usage policies") ||
        msg.includes("content filtering") ||
        msg.includes("violates our")
      ) {
        throw new SmolContentPolicyError(error.message, http);
      }
      throw smolErrorForStatus(error.message, http);
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
    this.logger.debug("Sending request to Anthropic:", redactAttachments(debugData));
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
    const parsed = parseAnthropicHostedTools(response, "anthropic");
    const { results: hostedToolResults, cost: finalCost } = applyHostedToolCost(
      parsed,
      cost,
      this.getModel(),
      this.config.modelData,
    );

    const result: PromptResult = {
      output,
      toolCalls,
      usage,
      cost: finalCost,
      model: this.getModel(),
    };
    if (thinkingBlocks.length > 0) {
      result.thinkingBlocks = thinkingBlocks;
    }
    if (hostedToolResults.length > 0) {
      result.hostedToolResults = hostedToolResults;
    }
    return success(result);
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
      redactAttachments(streamDebugData),
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
    // Track server-side web_search blocks by index -> partial input JSON. The
    // query streams in as input_json_delta just like a client tool call; we
    // parse it once the block stops and emit a live `web_search` chunk.
    const webSearchBlocks = new Map<number, { arguments: string }>();
    // Accumulated hosted-tool signal for the final `done` result (parity with
    // the non-streaming path's `hostedToolResults`).
    const webSearchQueries: string[] = [];
    const webSearchSources: WebSearchSource[] = [];
    let webSearchRequests: number | undefined;
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
        } else if (
          event.content_block.type === "server_tool_use" &&
          event.content_block.name === "web_search"
        ) {
          webSearchBlocks.set(event.index, { arguments: "" });
        } else if (event.content_block.type === "web_search_tool_result") {
          // Server tool results arrive whole (no deltas). Collect sources so
          // the final `done` result carries them, matching _textSync.
          for (const r of event.content_block.content || []) {
            if (r && typeof r.url === "string") {
              webSearchSources.push({ url: r.url, title: r.title });
            }
          }
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
          const searchBlock = webSearchBlocks.get(event.index);
          if (searchBlock) {
            searchBlock.arguments += event.delta.partial_json;
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
        // Emit the web search query the moment its block completes, so
        // consumers see the keywords live rather than only in the final result.
        const searchBlock = webSearchBlocks.get(event.index);
        if (searchBlock) {
          let query: string | undefined;
          try {
            query = JSON.parse(searchBlock.arguments || "{}")?.query;
          } catch {
            // Malformed/partial JSON — skip this block rather than throw.
          }
          if (typeof query === "string" && query.length > 0) {
            webSearchQueries.push(query);
            yield { type: "web_search", query };
          }
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
        // Billable web-search count, for hosted-tool cost on the done result.
        if (event.usage.server_tool_use?.web_search_requests != null) {
          webSearchRequests = event.usage.server_tool_use.web_search_requests;
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
    let cost = this.model.calculateCost(usage) ?? undefined;

    // Fold hosted-tool (web search) results into the done result so the
    // streaming path reports the same `hostedToolResults` as _textSync. The
    // live `web_search` chunks above already surfaced the queries; this is the
    // durable record (queries + sources + billed cost).
    let hostedToolResults: HostedToolResult[] = [];
    const usedWebSearch =
      webSearchQueries.length > 0 ||
      webSearchSources.length > 0 ||
      (webSearchRequests ?? 0) > 0;
    if (usedWebSearch) {
      const applied = applyHostedToolCost(
        [
          webSearchResult("anthropic", {
            queries: webSearchQueries,
            sources: webSearchSources,
            callCount: webSearchRequests,
          }),
        ],
        cost,
        this.getModel(),
        this.config.modelData,
      );
      hostedToolResults = applied.results;
      cost = applied.cost;
    }

    yield {
      type: "done",
      result: {
        output: content || null,
        toolCalls,
        ...(thinkingBlocks.length > 0 && { thinkingBlocks }),
        usage,
        cost,
        model: this.getModel(),
        ...(hostedToolResults.length > 0 && { hostedToolResults }),
      },
    };
  }
}
