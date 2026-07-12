export * from "./types/result.js";
export * from "./classes/message/contentParts.js";
import { LogLevel } from "./util/logger.js";
import z, { ZodType } from "zod";
import { Message } from "./classes/message/index.js";
import { ToolCall } from "./classes/ToolCall.js";
import { Model } from "./model.js";
import { ModelName } from "./models.js";
import type { ModelDataBlob } from "./modelData.js";
import { Result } from "./types/result.js";
import { TokenUsage } from "./types/tokenUsage.js";
import { CostEstimate } from "./types/costEstimate.js";
export * from "./types/costEstimate.js";
export * from "./types/tokenUsage.js";

export type SmolConfig = {
  /** The model to use. */
  model: ModelName;

  /** Override the provider for the given model (e.g., use a custom endpoint for an OpenAI-compatible model). */
  provider?: string;

  /** API keys, nested by provider. Each key falls back to its conventional env var
   *  if unset (e.g. apiKey.openAi → OPENAI_API_KEY). */
  apiKey?: {
    openAi?: string;
    google?: string;
    anthropic?: string;
    ollama?: string;
    openRouter?: string;
    deepInfra?: string;
    liteLlm?: string;
    openAiCompat?: string;
  };

  /** Custom base URLs, nested by provider. Defaults are baked in where applicable
   *  (e.g. openrouter, deepinfra); litellm and openai-compat require an explicit URL. */
  baseUrl?: {
    /** Host URL for the Ollama server. Defaults to http://localhost:11434 (or $OLLAMA_HOST). */
    ollama?: string;
    openRouter?: string;
    deepInfra?: string;
    liteLlm?: string;
    openAiCompat?: string;
  };

  /** Log level for internal debug logging. */
  logLevel?: LogLevel;

  /** Configuration for Statelog observability/tracing integration. */
  statelog?: Partial<{
    host: string;
    projectId: string;
    traceId: string;
    debugMode: boolean;
    apiKey: string;
  }>;

  /** Lifecycle hooks called at various points during execution. */
  hooks?: Partial<{
    onStart: (config: SmolConfig) => void;
    onToolCall: (toolCall: ToolCall) => void;
    onEnd: (result: PromptResult) => void;
    onError: (error: Error) => void;
  }>;

  /** Arbitrary metadata passed to custom model providers. */
  metadata?: Record<string, any>;

  /** Options for image/PDF attachments on user messages. */
  attachments?: {
    /** Max resolved attachment size in bytes. Default 20 MB. Over → Failure. */
    maxBytes?: number;
  };

  /** Refreshed model/hosted-tool data (from refreshModels) to layer over the baked-in registry for this call. */
  modelData?: ModelDataBlob;

  // ── Per-call fields ─────────────────────────────────────────────────

  /** The conversation messages to send to the model. */
  messages: Message[];

  /** Tools (functions) the model can call. */
  tools?: {
    name: string;
    description?: string;
    schema: ZodType;
  }[];

  /** Provider hosted tools (server-side) to enable for this call, by capability
   *  name (catalog category), e.g. ["web_search"]. Distinct from `tools`
   *  (client functions) — hosted tools run server-side and can't be intercepted. */
  hostedTools?: string[];

  /** Maximum number of tokens the model can generate in its response. */
  maxTokens?: number;

  /** Sampling temperature (0-2). (OpenAI only) */
  temperature?: number;

  /** Number of alternative completions to generate. */
  numSuggestions?: number;

  /** Whether the model can call multiple tools in a single turn. (OpenAI Responses API only) */
  parallelToolCalls?: boolean;

  /** A Zod schema to constrain the model's output to structured JSON matching the schema. */
  responseFormat?: ZodType;

  /** If true, returns an AsyncGenerator of StreamChunks instead of a single result. */
  stream?: boolean;

  /** Enable extended thinking / thought signatures. (Anthropic and Google only) */
  thinking?: {
    enabled: boolean;
    budgetTokens?: number;
  };

  /** Prompt caching. Currently used by Anthropic; OpenAI/Google cache automatically. Defaults to enabled. */
  caching?: {
    enabled?: boolean;
  };

  /** Provider-agnostic reasoning effort level. */
  reasoningEffort?: "low" | "medium" | "high";

  responseFormatOptions?: Partial<{
    name: string;
    strict: boolean;
    numRetries: number;
    allowExtraKeys: boolean;
  }>;

  /** Arbitrary provider-specific attributes passed directly to the underlying API call. */
  rawAttributes?: Record<string, any>;

  /** If set, returns a failure when the number of messages exceeds this limit. */
  maxMessages?: number;

  /** An AbortSignal for cancelling the request. */
  abortSignal?: AbortSignal;

  /** Define behavior if too many repeated tool calls are detected (loop prevention). */
  toolLoopDetection?: ToolLoopDetection;
};

export type ToolLoopDetection = {
  enabled: boolean;
  maxCalls: number;
  intervention?:
    | "remove-tool"
    | "remove-all-tools"
    | "throw-error"
    | "halt-execution";
  excludeTools?: string[];
};

export type WebSearchSource = {
  url: string;
  title?: string;
  snippet?: string;
};

export type WebSearchCitation = {
  url: string;
  title?: string;
  startIndex?: number;
  endIndex?: number;
};

export type HostedToolResult = {
  tool: string; // capability name (catalog category), e.g. "web_search"
  provider: string;
  queries?: string[];
  sources?: WebSearchSource[];
  citations?: WebSearchCitation[];
  callCount?: number; // billable operations the provider reported
  estimatedCost?: number; // USD; callCount x catalog price; undefined if not derivable
  raw?: unknown; // provider payload, unnormalized (escape hatch)
};

export type PromptResult = {
  output: string | null;
  toolCalls: ToolCall[];
  thinkingBlocks?: ThinkingBlock[];
  usage?: TokenUsage;
  cost?: CostEstimate;
  model?: ModelName;
  hostedToolResults?: HostedToolResult[];
};

export function promptResult({
  output,
  toolCalls,
  thinkingBlocks,
  usage,
  cost,
  model,
  hostedToolResults,
}: Partial<PromptResult>): PromptResult {
  return {
    output: output || null,
    toolCalls: toolCalls || [],
    thinkingBlocks: thinkingBlocks,
    usage,
    cost,
    model,
    hostedToolResults,
  };
}

export type StreamChunk =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string; signature?: string }
  | { type: "tool_call"; toolCall: ToolCall }
  /** A provider-run web search (server-side tool). Emitted the moment a
   *  search block completes, so consumers can surface the query live. One
   *  chunk per search; a turn may emit several. The same queries also appear
   *  in the final `done` result's `hostedToolResults`. */
  | { type: "web_search"; query: string }
  | { type: "done"; result: PromptResult }
  | { type: "error"; error: string }
  | { type: "timeout"; error: string };

export interface SmolClient {
  text(
    config: SmolConfig,
  ): Promise<Result<PromptResult>> | AsyncGenerator<StreamChunk>;
  textSync(config: SmolConfig): Promise<Result<PromptResult>>;
  _textSync(config: SmolConfig): Promise<Result<PromptResult>>;
  textStream(config: SmolConfig): AsyncGenerator<StreamChunk>;
  _textStream(config: SmolConfig): AsyncGenerator<StreamChunk>;
}

/** Loose variant of SmolConfig for `getClient()` — messages are not required at construction time. */
export type SmolClientConfig = Omit<SmolConfig, "messages"> & {
  messages?: Message[];
};

export type ModelLike = ModelName | Model;

export type ThinkingBlock = {
  text: string;
  signature: string;
};

export const ThinkingBlockSchema = z.object({
  text: z.string(),
  signature: z.string(),
});
