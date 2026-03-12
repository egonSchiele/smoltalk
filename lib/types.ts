export * from "./types/result.js";
import { LogLevel } from "egonlog";
import z, { ZodType } from "zod";
import { Message } from "./classes/message/index.js";
import { ToolCall } from "./classes/ToolCall.js";
import { Model } from "./model.js";
import { ModelName } from "./models.js";
import { Strategy, StrategyJSON } from "./strategies/types.js";
import { Result } from "./types/result.js";
import { TokenUsage } from "./types/tokenUsage.js";
import { CostEstimate } from "./types/costEstimate.js";
export * from "./types/costEstimate.js";
export * from "./types/tokenUsage.js";

export type PromptConfig = {
  /** The conversation messages to send to the model. */
  messages: Message[];

  /** Tools (functions) the model can call. Each tool has a name, optional description, and a Zod schema defining its parameters. */
  tools?: {
    name: string;
    description?: string;
    schema: ZodType;
  }[];

  /** Maximum number of tokens the model can generate in its response. */
  maxTokens?: number;

  /** Sampling temperature (0-2). Higher values make output more random, lower values more deterministic. (OpenAI only) */
  temperature?: number;

  /** Number of alternative completions to generate. Not currently used by any provider. */
  numSuggestions?: number;

  /** Whether the model can call multiple tools in a single turn. (OpenAI Responses API only) */
  parallelToolCalls?: boolean;

  /** A Zod schema to constrain the model's output to structured JSON matching the schema. */
  responseFormat?: ZodType;

  /** If true, returns an AsyncGenerator of StreamChunks instead of a single result. */
  stream?: boolean;

  /**
   * Enable extended thinking / thought signatures.
   * When enabled, the model returns its reasoning process alongside the response.
   * (Anthropic and Google only — OpenAI reasoning tokens are not exposed)
   */
  thinking?: {
    /** Whether to enable extended thinking. */
    enabled: boolean;
    /** Token budget for the thinking process. Defaults to 5000. (Anthropic only) */
    budgetTokens?: number;
  };

  /**
   * Provider-agnostic reasoning effort level.
   * - OpenAI: passed as reasoning_effort / reasoning.effort
   * - Anthropic: mapped to thinking budget (low=2048, medium=5000, high=10000)
   * - Google: mapped to thinkingBudget (low=2048, medium=8192, high=16384)
   * If `thinking` is also set, it takes precedence for Anthropic/Google.
   */
  reasoningEffort?: "low" | "medium" | "high";

  responseFormatOptions?: Partial<{
    /**
     * Identifier for the JSON schema sent to OpenAI's structured output API
     * (e.g. "math_response"). Defaults to "response".
     * OpenAI's json_schema response format *requires* a name field. The name helps
     * OpenAI identify and cache the schema. Smoltalk defaults it to "response"
     * so users don't have to think about it, but the option is there if someone
     * wants to set a more descriptive name (OpenAI recommends it for clarity in their docs).
     */
    name: string;
    /** Whether to enforce strict schema adherence. */
    strict: boolean;
    /** Number of retries if validation fails. Defaults to 2 when strict is true. */
    numRetries: number;
    /** If true, strip extra keys from the response instead of failing validation. */
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

export type SmolConfig = {
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

  /** Directory path for Llama.cpp models. Required when using the Llama.cpp client. */
  llamaCppModelDir?: string;

  /**
  The given model determines both
  - what client is used
  - what strategy is executed.

  ## 1. Specifying a model directly
  The simplest case is to specify the name of a model from lib/models.ts.
  Example:

  ```
    model: "claude-sonnet-4-6"
  ```

  ## 2. Specifying a strategy
  You can instead specify a strategy to execute. For example:

  ```
    model: {
      type: "race",
      params: {
        strategies: ["gemini-2.5-flash-lite", "gemini-2.5-pro"],
      },
    }
  ```

  In this case, Smoltalk will run your request over using both LLMs simultaneously,
  and take the response that finishes first.

  You can also choose to specify fallbacks in case the first model
  returns an error for some reason. This can be a good way to try something
  with a fast model and then use a slower but more powerful model if the first one fails.

  ```
    model: {
      type: "fallback",
      params: {
        primaryStrategy: "gemini-2.5-flash-lite",
        config: {
          error: ["gemini-2.5-pro"],
        },
      },
    }
  ```

  You can of course combine strategies together to create more complex behavior:

  ```
    const geminiLiteWithFallback = {
      type: "fallback",
      params: {
        primaryStrategy: "gemini-2.5-flash-lite",
        config: {
          error: ["gemini-2.5-pro"],
        },
      },
    };

    model: {
      type: "race",
      params: {
        strategies: ["gemini-2.5-pro", geminiLiteWithFallback],
      },
    }
  ```
    */
  model: ModelParam;

  /** Override the provider for the given model (e.g., use a custom endpoint for an OpenAI-compatible model). */
  provider?: string;

  /** Log level for internal debug logging. */
  logLevel?: LogLevel;

  /** Configuration for Statelog observability/tracing integration. */
  statelog?: Partial<{
    /** Statelog server host URL. */
    host: string;
    /** Project identifier for grouping traces. */
    projectId: string;
    /** Trace identifier for correlating related requests. */
    traceId: string;
    /** Enable debug mode for verbose Statelog output. */
    debugMode: boolean;
    /** API key for authenticating with the Statelog server. */
    apiKey: string;
  }>;

  /** Lifecycle hooks called at various points during execution. */
  hooks?: Partial<{
    /** Called when the prompt execution starts. */
    onStart: (config: PromptConfig) => void;
    /** Called each time the model invokes a tool. */
    onToolCall: (toolCall: ToolCall) => void;
    /** Called when the prompt execution completes successfully. */
    onEnd: (result: PromptResult) => void;
    /** Called when an error occurs during execution. */
    onError: (error: Error) => void;
    /** Called when a strategy begins execution. */
    onStrategyStart: (strategy: Strategy, config: SmolPromptConfig) => void;
  }>;

  /** Arbitrary metadata passed to custom model providers. */
  metadata?: Record<string, any>;
};

export type ToolLoopDetection = {
  enabled: boolean;

  /* Max calls for a specific tool before intervention is triggered. */
  maxCalls: number;

  /* Define the intervention to take when the max calls limit is reached. */
  intervention?:
    | "remove-tool"
    | "remove-all-tools"
    | "throw-error"
    | "halt-execution";

  /* These tools will be excluded from loop detection. */
  excludeTools?: string[];
};

export type ResolvedSmolConfig = Omit<SmolConfig, "model"> & {
  model: ModelName;
};

export type BaseClientConfig = ResolvedSmolConfig;

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
    promptConfig: PromptConfig,
  ): Promise<Result<PromptResult>> | AsyncGenerator<StreamChunk>;
  textSync(config: PromptConfig): Promise<Result<PromptResult>>;

  // Override this function to provide synchronous text generation implementation
  _textSync(config: PromptConfig): Promise<Result<PromptResult>>;
  textStream(config: PromptConfig): AsyncGenerator<StreamChunk>;

  // Override this function to provide streaming text generation implementation
  _textStream(config: PromptConfig): AsyncGenerator<StreamChunk>;
}

export type SmolPromptConfig = PromptConfig & SmolConfig;

export type TextPart = {
  type: "text";
  text: string;
};

export type ModelLike = ModelName | Model;
export type ModelParam = ModelName | Strategy | StrategyJSON;

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
