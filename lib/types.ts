export * from "./types/result.js";
import { LogLevel } from "egonlog";
import { ZodType } from "zod";
import { Message } from "./classes/message/index.js";
import { ToolCall } from "./classes/ToolCall.js";
import { ModelName, ModelSource } from "./models.js";
import { Result } from "./types/result.js";

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

  // used by openai
  responseFormatOptions?: Partial<{
    name: string;
    strict: boolean;

    // 2 by default, if strict is true
    numRetries: number;
  }>;

  rawAttributes?: Record<string, any>;
};

export type SmolConfig = {
  openAiApiKey?: string;
  googleApiKey?: string;
  // only needed for cloud ollama
  ollamaApiKey?: string;
  ollamaHost?: string;
  model: ModelName;
  provider?: ModelSource;
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

export type BaseClientConfig = SmolConfig & {
  //logger: EgonLog;
};

export type PromptResult = { output: string | null; toolCalls: ToolCall[] };

export type StreamChunk =
  | { type: "text"; text: string }
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

export type TextPart = {
  type: "text";
  text: string;
};
