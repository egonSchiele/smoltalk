export * from "./types/result.js";
import { LogLevel } from "egonlog";
import z, { ZodType } from "zod";
import { Message } from "./classes/message/index.js";
import { ToolCall } from "./classes/ToolCall.js";
import { Model } from "./model.js";
import { ModelName } from "./models.js";
import {
  ModelConfig,
  ModelNameAndProvider,
  Strategy,
  StrategyJSON,
} from "./strategies/types.js";
import { Result } from "./types/result.js";

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

export type Budget = {
  timeBudgetMs?: number;
  tokenBudget?: number;
  tokensUsed?: number;
  costBudget?: number;
  costUsed?: number;
  requestBudget?: number;
  requestsUsed?: number;
};

export type PromptConfig = {
  /** The conversation messages to send to the model. */
  messages: Message[];

  /** Tools (functions) the model can call. Each tool has a name, optional description, and a Zod schema defining its parameters. */
  tools?: {
    name: string;
    description?: string;
    schema: ZodType;
  }[];

  /** System-level instructions prepended to the conversation. (OpenAI Responses API only) */
  instructions?: string;

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

  /**
   * Additional options for structured output validation and retries. (OpenAI only)
   */
  responseFormatOptions?: Partial<{
    /** Name for the response format schema. */
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

  /** Resource budget (time, tokens, cost, requests) for this call. */
  budget?: Budget;

  /** An AbortSignal for cancelling the request. */
  abortSignal?: AbortSignal;

  /** Define behavior if too many repeated tool calls are detected (loop prevention). */
  toolLoopDetection?: ToolLoopDetection;

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

  ## 2. Specifying a model config (letting Smoltalk pick the model)
  You can instead also choose to let Smoltalk pick the model that it thinks
  will be best for certain parameters. For example:
  ```
    model: {
      // find the fastest model
      optimizeFor: ["speed"],

      // from either Anthropic or Google, whichever is faster
      providers: ["anthropic", "google"],
      limit: {
        // 1 mil input tokens + 1 mil output tokens together
        // should cost less than $10 for the models being considered
        cost: 10,
      },
    }
  ```

  This can be a good option because as better models come out,
  you won't need to update your code. You can just update Smoltalk
  and it will pick the best model automatically.

  ## 3. Specifying a strategy
  Finally, you can instead specify a strategy to execute. For example:

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

  /** Arbitrary metadata passed to custom/registered model providers. */
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

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  totalTokens?: number;
};

export const TokenUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cachedInputTokens: z.number().optional(),
  totalTokens: z.number().optional(),
});

export type CostEstimate = {
  inputCost: number;
  outputCost: number;
  cachedInputCost?: number;
  totalCost: number;
  currency: string;
};

export const CostEstimateSchema = z.object({
  inputCost: z.number(),
  outputCost: z.number(),
  cachedInputCost: z.number().optional(),
  totalCost: z.number(),
  currency: z.string(),
});

export function addTokenUsage(_a?: TokenUsage, _b?: TokenUsage): TokenUsage {
  let a = _a;
  let b = _b;
  if (a && !b) return a;
  if (b && !a) return b;
  if (!a && !b) return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  a = _a as TokenUsage;
  b = _b as TokenUsage;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedInputTokens: (a.cachedInputTokens || 0) + (b.cachedInputTokens || 0),
    totalTokens: (a.totalTokens || 0) + (b.totalTokens || 0),
  };
}

export function addCosts(_a?: CostEstimate, _b?: CostEstimate): CostEstimate {
  let a = _a;
  let b = _b;
  if (a && !b) return a;
  if (b && !a) return b;
  if (!a && !b)
    return { inputCost: 0, outputCost: 0, totalCost: 0, currency: "USD" };
  a = _a as CostEstimate;
  b = _b as CostEstimate;
  if (a.currency !== b.currency) {
    throw new Error(
      `Cannot add costs with different currencies: ${a.currency} and ${b.currency}`,
    );
  }
  return {
    inputCost: a.inputCost + b.inputCost,
    outputCost: a.outputCost + b.outputCost,
    cachedInputCost: (a.cachedInputCost || 0) + (b.cachedInputCost || 0),
    totalCost: a.totalCost + b.totalCost,
    currency: a.currency,
  };
}

export type PromptResult = {
  output: string | null;
  toolCalls: ToolCall[];
  thinkingBlocks?: ThinkingBlock[];
  usage?: TokenUsage;
  cost?: CostEstimate;
  model?: ModelName | ModelConfig;
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

export type ModelLike = ModelName | ModelConfig | Model | ModelNameAndProvider;
export type ModelParam =
  | ModelName
  | ModelConfig
  | ModelNameAndProvider
  | Strategy
  | StrategyJSON;
