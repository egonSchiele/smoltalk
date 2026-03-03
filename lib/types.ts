export * from "./types/result.js";
import { LogLevel } from "egonlog";
import { ZodType } from "zod";
import { Message } from "./classes/message/index.js";
import { ToolCall } from "./classes/ToolCall.js";
import { ModelConfig, ModelName, Provider } from "./models.js";
import { Result } from "./types/result.js";

export type ThinkingBlock = {
  text: string;
  signature: string;
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
};

export type SmolConfig = {
  openAiApiKey?: string;
  googleApiKey?: string;
  anthropicApiKey?: string;
  // only needed for cloud ollama
  ollamaApiKey?: string;
  ollamaHost?: string;
  model: ModelName | ModelConfig;
  provider?: Provider;
  logLevel?: LogLevel;
  toolLoopDetection?: ToolLoopDetection;
};

export type ToolLoopDetection = {
  enabled: boolean;
  maxConsecutive: number;
  intervention?:
    | "remove-tool"
    | "remove-all-tools"
    | "throw-error"
    | "halt-execution";
  excludeTools?: string[];
};

export type ResolvedSmolConfig = Omit<SmolConfig, "model"> & {
  model: ModelName;
};

export type BaseClientConfig = ResolvedSmolConfig & {
  //logger: EgonLog;
};

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
  | { type: "error"; error: string };

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

export type SmolPromptConfig = SmolConfig & PromptConfig;

export type TextPart = {
  type: "text";
  text: string;
};
