export * from "./types/result.js";
import { EgonLog, LogLevel } from "egonlog";
import { ModelName } from "./models.js";
import { Result } from "./index.js";

export type PromptConfig<Tool = any> = {
  tools?: Tool[];
  messages?: { role: string; content: string; name?: string }[];
  instructions?: string;
  maxTokens?: number;
  temperature?: number;
  numSuggestions?: number;
  parallelToolCalls?: boolean;
  responseFormat?: any;
};

export type SmolConfig = {
  apiKey: string;
  model: ModelName;
  logLevel?: LogLevel;
};

export type BaseClientConfig = SmolConfig & {
  logger: EgonLog;
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, any>;
};

export type PromptResult = { output: string | null; toolCalls: ToolCall[] };

export interface SmolClient {
  text(content: string, config?: PromptConfig): Promise<Result<PromptResult>>;
}
