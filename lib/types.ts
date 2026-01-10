export * from "./types/result.js";
import { EgonLog, LogLevel } from "egonlog";
import { ModelName } from "./models.js";
import { Message } from "./classes/message/index.js";
import { Result } from "./types/result.js";
import { ToolCall } from "./classes/ToolCall.js";
import { OpenAIToolDefinition } from "./util/common.js";
import { ResponseFormatJSONSchema, ResponseFormatText } from "openai/resources";
import { z } from "zod";

export type PromptConfig = {
  messages: Message[];
  tools?: OpenAIToolDefinition[];
  instructions?: string;
  maxTokens?: number;
  temperature?: number;
  numSuggestions?: number;
  parallelToolCalls?: boolean;
  responseFormat?: z.ZodType;
  responseFormatName?: string;
  rawAttributes?: Record<string, any>;
};

export type SmolConfig = {
  openAiApiKey?: string;
  googleApiKey?: string;
  model: ModelName;
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
