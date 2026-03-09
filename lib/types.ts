export * from "./types/result.js";
import { LogLevel } from "egonlog";
import { ZodType } from "zod";
import { Message } from "./classes/message/index.js";
import { ToolCall } from "./classes/ToolCall.js";
import { Model, ModelConfig } from "./model.js";
import { ModelName, Provider } from "./models.js";
import { Strategy, StrategyJSON } from "./strategies/types.js";
import { Result } from "./types/result.js";

export type ThinkingBlock = {
  text: string;
  signature: string;
};

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
  messages: Message[];
  tools?: {
    name: string;
    description?: string;
    schema: ZodType;
  }[];
  instructions?: string;
  maxTokens?: number;
  temperature?: number;
  numSuggestions?: number;
  parallelToolCalls?: boolean;
  responseFormat?: ZodType;
  stream?: boolean;

  // Enable extended thinking / thought signatures (Anthropic and Google)
  thinking?: {
    enabled: boolean;
    // Anthropic: token budget for thinking (defaults to 5000)
    budgetTokens?: number;
  };

  // Provider-agnostic reasoning effort level
  // OpenAI: passed as reasoning_effort / reasoning.effort
  // Anthropic: mapped to thinking budget (low=2048, medium=5000, high=10000)
  // Google: mapped to thinkingBudget (low=2048, medium=8192, high=16384)
  // If `thinking` is also set, it takes precedence for Anthropic/Google
  reasoningEffort?: "low" | "medium" | "high";

  // used by openai
  responseFormatOptions?: Partial<{
    name: string;
    strict: boolean;

    // 2 by default, if strict is true
    numRetries: number;

    // strip extra keys instead of failing validation
    allowExtraKeys: boolean;
  }>;

  rawAttributes?: Record<string, any>;

  // If set, returns a failure when the number of messages exceeds this limit
  maxMessages?: number;

  // Resource budget for this call
  budget?: Budget;

  // User-provided AbortSignal for cancellation
  abortSignal?: AbortSignal;

  /* Define behavior if too many tool calls are made. */
  toolLoopDetection?: ToolLoopDetection;

  hooks?: Partial<{
    onStart: (config: PromptConfig) => void;
    onToolCall: (toolCall: ToolCall) => void;
    onEnd: (result: PromptResult) => void;
    onError: (error: Error) => void;
    onStrategyStart: (strategy: Strategy, config: SmolPromptConfig) => void;
  }>;
};

export type SmolConfig = {
  openAiApiKey?: string;
  googleApiKey?: string;
  anthropicApiKey?: string;
  // only needed for cloud ollama
  ollamaApiKey?: string;
  ollamaHost?: string;

  /*
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
        strategies: ["gemini-2.5-flash-lite", "gemini-2.5-pro"],
        config: {
          fallbackOn: ["error"],
        },
      },
    }
  ```

  You can of course combine strategies together to create more complex behavior:

  ```
    const geminiLiteWithFallback = {
      type: "fallback",
      params: {
        strategies: ["gemini-2.5-flash-lite", "gemini-2.5-pro"],
        config: {
          fallbackOn: ["error"],
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
  provider?: Provider;
  logLevel?: LogLevel;
  statelog?: Partial<{
    host: string;
    projectId: string;
    traceId: string;
    debugMode: boolean;
    apiKey: string;
  }>;
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

export type CostEstimate = {
  inputCost: number;
  outputCost: number;
  cachedInputCost?: number;
  totalCost: number;
  currency: string;
};

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
  prompt(
    text: string,
    config?: PromptConfig,
  ): Promise<Result<PromptResult>> | AsyncGenerator<StreamChunk>;
}

export type SmolPromptConfig = PromptConfig & SmolConfig;

export type TextPart = {
  type: "text";
  text: string;
};

export type ModelLike = ModelName | ModelConfig | Model;
export type ModelParam = ModelName | ModelConfig | Strategy | StrategyJSON;
