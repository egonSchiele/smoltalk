import OpenAI from "openai";
import {
  BaseClientConfig,
  PromptConfig,
  PromptResult,
  Result,
  SmolClient,
  success,
} from "../types.js";
import { EgonLog } from "egonlog";
import {
  ChatCompletion,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from "openai/resources";
import { ToolCall } from "../classes/ToolCall.js";
import { isFunctionToolCall } from "../util.js";
import { getLogger } from "../logger.js";
import { BaseClient } from "./baseClient.js";
import { zodToOpenAITool } from "../util/tool.js";

export type SmolOpenAiConfig = BaseClientConfig;

export class SmolOpenAi extends BaseClient implements SmolClient {
  private client: OpenAI;
  private logger: EgonLog;
  private model: string;
  constructor(config: SmolOpenAiConfig) {
    super();
    if (!config.openAiApiKey) {
      throw new Error("OpenAI API key is required for SmolOpenAi client.");
    }
    this.client = new OpenAI({ apiKey: config.openAiApiKey });
    this.logger = getLogger();
    this.model = config.model;
  }

  getClient() {
    return this.client;
  }

  getModel() {
    return this.model;
  }

  async _text(config: PromptConfig): Promise<Result<PromptResult>> {
    const messages = config.messages.map((msg) => msg.toOpenAIMessage());
    const request = {
      model: this.model,
      messages,
      tools: config.tools?.map((tool) => {
        return zodToOpenAITool(tool.name, tool.schema, {
          description: tool.description,
        });
      }),
    };
    if (config.responseFormat) {
      (request as any).response_format = {
        type: "json_schema",

        json_schema: {
          name: config.responseFormatOptions?.name || "response",
          schema: config.responseFormat.toJSONSchema(),
        },
      };
    }

    this.logger.debug(
      "Sending request to OpenAI:",
      JSON.stringify(request, null, 2)
    );

    const completion: ChatCompletion =
      await this.client.chat.completions.create(request);
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
          toolCalls.push(
            new ToolCall(tc.id, tc.function.name, tc.function.arguments)
          );
        } else {
          this.logger.warn(
            `Unsupported tool call type: ${tc.type} for tool call ID: ${tc.id}`
          );
        }
      }
    }

    return success({ output, toolCalls });
  }
}
