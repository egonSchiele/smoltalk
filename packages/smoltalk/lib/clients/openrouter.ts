import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources";
import { SmolOpenAiCompat } from "./openaiCompat.js";
import type {
  SmolConfig,
  HostedToolResult,
  OpenRouterProviderPreferences,
} from "../types.js";
import { webSearchResult } from "../util/hostedTools.js";
import type { ReasoningPart } from "../util/reasoning.js";
import { resolveApiKey, resolveBaseUrl } from "../util/provider.js";

const OPENROUTER_PROVIDER_FIELDS: Record<
  keyof OpenRouterProviderPreferences,
  string
> = {
  order: "order",
  only: "only",
  ignore: "ignore",
  allowFallbacks: "allow_fallbacks",
  requireParameters: "require_parameters",
  dataCollection: "data_collection",
  sort: "sort",
  quantizations: "quantizations",
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The request's `provider` object: only the fields that are set, under
 *  OpenRouter's names. */
export function toOpenRouterProvider(
  prefs: OpenRouterProviderPreferences,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, wireName] of Object.entries(OPENROUTER_PROVIDER_FIELDS)) {
    const value = prefs[key as keyof OpenRouterProviderPreferences];
    if (value !== undefined) out[wireName] = value;
  }
  return out;
}

const EPHEMERAL = { type: "ephemeral" } as const;

function isAnthropicModel(model: string): boolean {
  return model.startsWith("anthropic/");
}

/** The content as parts with its last non-empty text part marked, or
 *  undefined when it has none (Anthropic refuses a breakpoint on an empty
 *  text block). */
function markLastTextPart(content: unknown): Record<string, unknown>[] | undefined {
  let parts: Record<string, unknown>[];
  if (typeof content === "string") {
    parts = [{ type: "text", text: content }];
  } else if (Array.isArray(content)) {
    parts = [...content];
  } else {
    return undefined;
  }
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (part?.type === "text" && typeof part.text === "string" && part.text !== "") {
      parts[i] = { ...part, cache_control: EPHEMERAL };
      return parts;
    }
  }
  return undefined;
}

/** Mark the last message with one of these roles that has a non-empty text
 *  part. One with none (an empty tool result, an image-only user turn) is
 *  passed over, because the prefix up to an earlier message is still worth
 *  caching. A copy; the input is not changed. */
function markLastMessageWithRole(
  messages: ChatCompletionMessageParam[],
  roles: string[],
): ChatCompletionMessageParam[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!roles.includes(message.role)) continue;
    const content = markLastTextPart(message.content);
    if (content === undefined) continue;
    const marked = [...messages];
    marked[i] = { ...message, content } as unknown as ChatCompletionMessageParam;
    return marked;
  }
  return messages;
}

/**
 * Anthropic caches only up to `cache_control` breakpoints the request marks;
 * OpenAI and Gemini cache without them. This marks the same three places as
 * the native client's `applyCacheBreakpoints`, in the shape OpenRouter
 * documents (https://openrouter.ai/docs/features/prompt-caching):
 *   1. the last function tool (`cache_control` on the `tools[]` item)
 *   2. the last system or developer message
 *   3. the last user or tool message, which in a tool loop is the latest
 *      tool result (Anthropic's user turn)
 * Messages carry it on their last non-empty text part, with string content
 * turned into a one-part array. Three is under OpenRouter's limit of four.
 */
export function markAnthropicCacheBreakpoints(
  messages: ChatCompletionMessageParam[],
  tools: OpenAI.Chat.ChatCompletionTool[] | undefined,
): {
  messages: ChatCompletionMessageParam[];
  tools: OpenAI.Chat.ChatCompletionTool[] | undefined;
} {
  let markedTools = tools;
  if (tools) {
    for (let i = tools.length - 1; i >= 0; i--) {
      if (tools[i].type !== "function") continue;
      markedTools = [...tools];
      // Not in the SDK's tool type, which only knows OpenAI's fields.
      markedTools[i] = {
        ...tools[i],
        cache_control: EPHEMERAL,
      } as unknown as OpenAI.Chat.ChatCompletionTool;
      break;
    }
  }
  let markedMessages = markLastMessageWithRole(messages, ["system", "developer"]);
  markedMessages = markLastMessageWithRole(markedMessages, ["user", "tool"]);
  return { messages: markedMessages, tools: markedTools };
}

/**
 * OpenRouter client (https://openrouter.ai). OpenAI-compatible chat completions.
 *
 * - Baked base URL `https://openrouter.ai/api/v1` (override via config.baseUrl.openRouter).
 * - Key: config.apiKey.openRouter or env OPENROUTER_API_KEY.
 * - Cost: reads `usage.cost` (USD). OpenRouter includes this in every
 *   response (in the final SSE chunk when streaming); no request flag needed.
 * - Provider routing: config.openRouter.provider becomes the request's
 *   `provider` field, in OpenRouter's snake_case names.
 * - The reply's top-level `provider` (the company that ran the model) and
 *   `message.reasoning` become `servedBy` and `reasoning` on the result.
 * - Hosted web_search: when config.hostedTools includes "web_search", a
 *   request that carries function tools gets the `openrouter:web_search`
 *   server tool, so the model decides when to search. A request with no
 *   function tools gets the `web` plugin instead (see usesSearchTool).
 *   Either way message.annotations becomes a HostedToolResult.
 * - Prompt caching: a request to an `anthropic/` model gets `cache_control`
 *   breakpoints (see markAnthropicCacheBreakpoints), unless
 *   `config.caching.enabled` is false. Other models cache without them, and
 *   their requests are left as they are.
 */
export class SmolOpenRouter extends SmolOpenAiCompat {
  protected resolveClientOptions(config: SmolConfig): {
    apiKey: string;
    baseURL: string;
  } {
    const apiKey = resolveApiKey("openrouter", config);
    // resolveBaseUrl bakes in the openrouter default, so this is always defined.
    const baseURL = resolveBaseUrl("openrouter", config)!;
    if (!apiKey) {
      throw new Error(
        "openrouter: API key required (config.apiKey.openRouter or OPENROUTER_API_KEY).",
      );
    }
    return { apiKey, baseURL };
  }

  protected resolveCostUsd(usage: any): number | undefined {
    return typeof usage?.cost === "number" ? usage.cost : undefined;
  }

  protected readServedBy(body: any): string | undefined {
    return nonEmptyString(body?.provider);
  }

  protected readReasoning(part: any): ReasoningPart | undefined {
    const text = nonEmptyString(part?.reasoning) ?? "";
    const details = Array.isArray(part?.reasoning_details) ? part.reasoning_details : undefined;
    if (text === "" && (details === undefined || details.length === 0)) return undefined;
    return { text, field: "reasoning", details };
  }

  /**
   * Whether this request searches with the `openrouter:web_search` server
   * tool rather than the `web` plugin. The server tool lets the model
   * decide when to search; the plugin runs one search on every request,
   * which in a tool loop means one on every round. But a server tool goes
   * in `tools`, and OpenRouter answers a request carrying `tools` for a
   * model that cannot call tools with 404 "No endpoints found that support
   * tool use". A request that already carries function tools can only be
   * served by a model that can call tools, so it is the one place the
   * server tool is safe. A request with none gets the plugin, which works
   * with any model, and with no tool loop it searches once.
   */
  private usesSearchTool(config: SmolConfig): boolean {
    if (!config.hostedTools?.includes("web_search")) return false;
    return (config.tools?.length ?? 0) > 0;
  }

  protected buildRequestExtras(config: SmolConfig): Record<string, unknown> {
    const extras: Record<string, unknown> = {};
    if (config.hostedTools?.includes("web_search") && !this.usesSearchTool(config)) {
      extras.plugins = [{ id: "web", max_results: 5 }];
    }
    if (config.openRouter?.provider) {
      extras.provider = toOpenRouterProvider(config.openRouter.provider);
    }
    return extras;
  }

  protected finalizeMessagesAndTools(
    messages: ChatCompletionMessageParam[],
    tools: OpenAI.Chat.ChatCompletionTool[] | undefined,
    config: SmolConfig,
  ): {
    messages: ChatCompletionMessageParam[];
    tools: OpenAI.Chat.ChatCompletionTool[] | undefined;
  } {
    if (!isAnthropicModel(this.getModel())) return { messages, tools };
    // The same opt-out as the native Anthropic client.
    if (config.caching?.enabled === false) return { messages, tools };
    return markAnthropicCacheBreakpoints(messages, tools);
  }

  protected hostedToolDefinitions(
    config: SmolConfig,
  ): OpenAI.Chat.ChatCompletionTool[] {
    if (!this.usesSearchTool(config)) return [];
    // Not in the SDK's tool union, which only knows OpenAI's own types.
    const searchTool = {
      type: "openrouter:web_search",
      parameters: { max_results: 5 },
    } as unknown as OpenAI.Chat.ChatCompletionTool;
    return [searchTool];
  }

  protected parseHostedToolResults(
    completion: any,
    config: SmolConfig,
  ): HostedToolResult[] {
    if (!config.hostedTools?.includes("web_search")) return [];
    // The server tool reports how many searches it ran; the plugin does not.
    let callCount = 0;
    const searches = completion?.usage?.server_tool_use?.web_search_requests;
    if (typeof searches === "number") {
      callCount = searches;
    }
    const annotations = completion?.choices?.[0]?.message?.annotations;
    if (!Array.isArray(annotations) || annotations.length === 0) {
      if (callCount === 0) return [];
      return [webSearchResult("openrouter", { callCount })];
    }

    const sources: { url: string; title?: string; snippet?: string }[] = [];
    const citations: {
      url: string;
      title?: string;
      startIndex?: number;
      endIndex?: number;
    }[] = [];

    for (const a of annotations) {
      if (a?.type !== "url_citation" || !a.url_citation?.url) continue;
      const uc = a.url_citation;

      const source: { url: string; title?: string; snippet?: string } = {
        url: uc.url,
      };
      if (uc.title) source.title = uc.title;
      if (uc.content) source.snippet = uc.content;
      sources.push(source);

      const citation: {
        url: string;
        title?: string;
        startIndex?: number;
        endIndex?: number;
      } = { url: uc.url };
      if (uc.title) citation.title = uc.title;
      if (typeof uc.start_index === "number") citation.startIndex = uc.start_index;
      if (typeof uc.end_index === "number") citation.endIndex = uc.end_index;
      citations.push(citation);
    }

    if (sources.length === 0 && callCount === 0) return [];
    let reportedCount = callCount;
    if (sources.length > 0 && reportedCount === 0) {
      // Citations mean at least one search ran, even when usage omits the count.
      reportedCount = 1;
    }
    return [
      webSearchResult("openrouter", {
        sources,
        citations,
        callCount: reportedCount,
      }),
    ];
  }
}
