import { EgonLog } from "egonlog";
import { ChatRequest, Message, Ollama } from "ollama";
import { ToolCall as OllamaToolCall } from "ollama";
import { ToolCall } from "../classes/ToolCall.js";
import { getLogger } from "../logger.js";
import {
  BaseClientConfig,
  PromptConfig,
  PromptResult,
  Result,
  SmolClient,
  success,
} from "../types.js";
import { zodToGoogleTool } from "../util/tool.js";
import { BaseClient } from "./baseClient.js";

export const DEFAULT_OLLAMA_HOST = "http://localhost:11434";
export type SmolOllamaConfig = BaseClientConfig;

export class SmolOllama extends BaseClient implements SmolClient {
  private logger: EgonLog;
  private model: string;
  private client: Ollama;
  constructor(config: SmolOllamaConfig) {
    super();
    this.logger = getLogger();
    this.model = config.model;
    if (config.ollamaApiKey) {
      this.client = new Ollama({
        host: "https://cloud.ollama.com",
        headers: { Authorization: "Bearer " + config.ollamaApiKey },
      });
    } else {
      const host = config.ollamaHost || DEFAULT_OLLAMA_HOST;
      this.client = new Ollama({ host });
    }
  }

  getClient() {
    return this.client;
  }

  getModel() {
    return this.model;
  }

  async text(config: PromptConfig): Promise<Result<PromptResult>> {
    const messages = config.messages.map((msg) => msg.toOpenAIMessage());

    const tools = (config.tools || []).map((tool) => {
      return zodToGoogleTool(tool.name, tool.schema, {
        description: tool.description,
      });
    });

    const request: ChatRequest = {
      messages: messages as Message[],
      model: this.model,
    };
    if (tools.length > 0) {
      request.tools = tools.map((t) => ({ type: "function", function: t }));
    }
    if (config.responseFormat) {
      request.format = config.responseFormat.toJSONSchema();
    }
    if (config.rawAttributes) {
      Object.assign(request, config.rawAttributes);
    }

    this.logger.debug(
      "Sending request to Ollama:",
      JSON.stringify(request, null, 2)
    );
    // @ts-ignore
    const result = await this.client.chat(request);

    this.logger.debug("Response from Ollama:", JSON.stringify(result, null, 2));

    const output = result.message?.content || null;
    const toolCalls: ToolCall[] = [];
    if (result.message?.tool_calls) {
      for (const tc of result.message.tool_calls) {
        const tool_call = tc as OllamaToolCall & { id: string };
        toolCalls.push(
          new ToolCall(
            tool_call.id,
            tool_call.function.name,
            tool_call.function.arguments || {}
          )
        );
      }
    }

    // Return the response, updating the chat history
    return success({ output, toolCalls });
  }
}
