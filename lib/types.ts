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
  responseFormatName?: string;
  rawAttributes?: Record<string, any>;
};

export type SmolConfig = {
  openAiApiKey?: string;
  googleApiKey?: string;
  model: ModelName;
  provider?: ModelSource;
  logLevel?: LogLevel;
};

export type BaseClientConfig = SmolConfig & {
  //logger: EgonLog;
};

export type PromptResult = { output: string | null; toolCalls: ToolCall[] };

export interface SmolClient {
  text(config: PromptConfig): Promise<Result<PromptResult>>;
  prompt(text: string, config?: PromptConfig): Promise<Result<PromptResult>>;
}

export type TextPart = {
  type: "text";
  text: string;
};
