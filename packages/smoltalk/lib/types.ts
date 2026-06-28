export * from "./types/result.js";
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

  /** API key for OpenAI. Required when using OpenAI models. */
  openAiApiKey?: string;

  /** API key for Google Gemini. Required when using Google models. */
  googleApiKey?: string;

  /** API key for Anthropic. Required when using Anthropic/Claude models. */
  anthropicApiKey?: string;

  /** API key for Ollama. Only needed when connecting to a cloud-hosted Ollama instance. */
  ollamaApiKey?: string;

  /** Base URL for the Ollama server. Defaults to localhost if not set. (Ollama only) */
  ollamaHost?: string;

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

export type PromptResult = {
  output: string | null;
  toolCalls: ToolCall[];
  thinkingBlocks?: ThinkingBlock[];
  usage?: TokenUsage;
  cost?: CostEstimate;
  model?: ModelName;
};

export function promptResult({
  output,
  toolCalls,
  thinkingBlocks,
  usage,
  cost,
  model,
}: Partial<PromptResult>): PromptResult {
  return {
    output: output || null,
    toolCalls: toolCalls || [],
    thinkingBlocks: thinkingBlocks,
    usage,
    cost,
    model,
  };
}

export type StreamChunk =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string; signature?: string }
  | { type: "tool_call"; toolCall: ToolCall }
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

export type TextPart = {
  type: "text";
  text: string;
};

/** Loose variant of SmolConfig for `getClient()` — messages are not required at construction time. */
export type SmolClientConfig = Omit<SmolConfig, "messages"> & {
  messages?: Message[];
};

export type ModelLike = ModelName | Model;

export type ThinkingBlock = {
  text: string;
  signature: string;
};

export const TextPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

export const ThinkingBlockSchema = z.object({
  text: z.string(),
  signature: z.string(),
});
