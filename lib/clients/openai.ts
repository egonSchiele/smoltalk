import OpenAI from "openai";
import {
  BaseClientConfig,
  PromptConfig,
  PromptResult,
  Result,
  SmolClient,
  success,
  ToolCall,
} from "../types.js";
import { EgonLog } from "egonlog";
import {
  ChatCompletion,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from "openai/resources";
import { isFunctionToolCall, openAIToToolCall } from "../util.js";

export type SmolOpenAiConfig = BaseClientConfig;

export class SmolOpenAi implements SmolClient {
  private client: OpenAI;
  private logger: EgonLog;
  private model: string;
  constructor(config: SmolOpenAiConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey });
    this.logger = config.logger;
    this.model = config.model;
  }

  getClient() {
    return this.client;
  }

  async text(
    content: string,
    config?: PromptConfig
  ): Promise<Result<PromptResult>> {
    const messages =
      structuredClone(config?.messages as ChatCompletionMessageParam[]) || [];

    messages.push({ role: "user", content });

    const completion: ChatCompletion =
      await this.client.chat.completions.create({
        model: this.model,
        messages,
        tools: config?.tools,
        response_format: config?.responseFormat,
      });
    this.logger.debug(
      "Response from OpenAI:",
      JSON.stringify(completion, null, 2)
    );
    const message: ChatCompletionMessage = completion.choices[0].message;
    const output = message.content;
    const _toolCalls: ChatCompletionMessageToolCall[] | undefined =
      message.tool_calls;

    const toolCalls: ToolCall[] = [];

    if (_toolCalls) {
      for (const tc of _toolCalls) {
        if (isFunctionToolCall(tc)) {
          toolCalls.push(openAIToToolCall(tc));
        } else {
          this.logger.warn(
            `Unsupported tool call type: ${tc.type} for tool call ID: ${tc.id}`
          );
        }
      }
    }

    if (toolCalls.length > 0) {
      this.logger.info("Tool calls detected:", toolCalls);
    }

    return success({ output, toolCalls });
  }
}
