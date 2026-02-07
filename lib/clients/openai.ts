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
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from "openai/resources";
import { ToolCall } from "../classes/ToolCall.js";
import { isFunctionToolCall } from "../util.js";
import { getLogger } from "../logger.js";
import { BaseClient } from "./baseClient.js";
import { zodToOpenAITool } from "../util/tool.js";
import { color } from "termcolors";

export type SmolOpenAiConfig = BaseClientConfig;

export class SmolOpenAi extends BaseClient implements SmolClient {
  private client: OpenAI;
  private logger: EgonLog;
  private model: string;
  constructor(config: SmolOpenAiConfig) {
    super(config);
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
      ...(config.rawAttributes || {}),
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
      JSON.stringify(request, null, 2),
    );

    if (config.stream) {
      console.log(color.yellow("Streaming response from OpenAI..."));
      const completion = await this.client.chat.completions.create({
        ...request,
        stream: true as const,
      });

      let content = "";
      const toolCallsMap = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();

      for await (const chunk of completion) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          process.stdout.write(color.blue(delta.content));
          content += delta.content;
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const index = tc.index;
            if (!toolCallsMap.has(index)) {
              toolCallsMap.set(index, {
                id: tc.id || "",
                name: tc.function?.name || "",
                arguments: tc.function?.arguments || "",
              });
            } else {
              const existing = toolCallsMap.get(index)!;
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name = tc.function.name;
              if (tc.function?.arguments)
                existing.arguments += tc.function.arguments;
            }
          }
        }
      }

      this.logger.debug("Streaming response completed from OpenAI");

      const toolCalls: ToolCall[] = [];
      for (const tc of toolCallsMap.values()) {
        toolCalls.push(new ToolCall(tc.id, tc.name, tc.arguments));
      }

      return success({ output: content || null, toolCalls });
    } else {
      console.log(color.yellow("NOT Streaming response from OpenAI..."));
      const completion = await this.client.chat.completions.create({
        ...request,
        stream: false as const,
      });

      this.logger.debug(
        "Response from OpenAI:",
        JSON.stringify(completion, null, 2),
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
              new ToolCall(tc.id, tc.function.name, tc.function.arguments),
            );
          } else {
            this.logger.warn(
              `Unsupported tool call type: ${tc.type} for tool call ID: ${tc.id}`,
            );
          }
        }
      }

      return success({ output, toolCalls });
    }
  }
}
