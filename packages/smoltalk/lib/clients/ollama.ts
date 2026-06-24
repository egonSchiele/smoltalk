import { EgonLog } from "../util/logger.js";
import { ChatRequest, Message, Ollama } from "ollama";
import { ToolCall as OllamaToolCall } from "ollama";
import { ToolCall } from "../classes/ToolCall.js";
import { getLogger } from "../util/logger.js";
import {
  PromptResult,
  Result,
  SmolClient,
  SmolConfig,
  StreamChunk,
  success,
} from "../types.js";
import { zodToGoogleTool } from "../util/tool.js";
import { sanitizeAttributes } from "../util/util.js";
import { BaseClient } from "./baseClient.js";
import { SmolContextWindowExceededError, SmolError } from "../smolError.js";
import { extractHttpErrorFields } from "../util/httpError.js";
import { ModelName } from "../models.js";
import { CostEstimate, TokenUsage } from "../types.js";
import { Model } from "../model.js";

export const DEFAULT_OLLAMA_HOST = "http://localhost:11434";
export type SmolOllamaConfig = SmolConfig;

export class SmolOllama extends BaseClient implements SmolClient {
  private logger: EgonLog;
  private model: Model;
  private client: Ollama;
  constructor(config: SmolOllamaConfig) {
    super(config);
    this.logger = getLogger();
    this.model = new Model(config.model);
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

  getModel(): ModelName {
    return this.model.getModel();
  }

  private calculateUsageAndCost(responseData: any): {
    usage?: TokenUsage;
    cost?: CostEstimate;
  } {
    let usage: TokenUsage | undefined;
    let cost: CostEstimate | undefined;

    if (responseData) {
      const inputTokens = responseData.prompt_eval_count || 0;
      const outputTokens = responseData.eval_count || 0;

      usage = {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      };

      const calculatedCost = this.model.calculateCost(usage);
      if (calculatedCost) {
        cost = calculatedCost;
      }
    }

    return { usage, cost };
  }

  private rethrowAsSmolError(error: unknown): never {
    const http = { ...extractHttpErrorFields(error), cause: error };
    const msg = ((error as Error).message || "").toLowerCase();
    if (msg.includes("context length") || msg.includes("context window")) {
      throw new SmolContextWindowExceededError((error as Error).message, http);
    }
    if (http.status !== undefined) {
      throw new SmolError((error as Error).message, http);
    }
    throw error;
  }

  async _textSync(config: SmolConfig): Promise<Result<PromptResult>> {
    const messages = config.messages.map((msg) => msg.toOpenAIMessage());

    const tools = (config.tools || []).map((tool) => {
      return zodToGoogleTool(tool.name, tool.schema, {
        description: tool.description,
      });
    });

    const request: ChatRequest = {
      messages: messages as Message[],
      model: this.getModel(),
    };
    if (tools.length > 0) {
      request.tools = tools.map((t) => ({ type: "function", function: t }));
    }
    if (config.responseFormat) {
      request.format = config.responseFormat.toJSONSchema();
    }
    Object.assign(request, sanitizeAttributes(config.rawAttributes));

    this.logger.debug(
      "Sending request to Ollama:",
      JSON.stringify(request, null, 2),
    );
    this.statelogClient?.promptRequest(request as any);
    const signal = this.getAbortSignal(config);
    const abortHandler = signal ? () => this.client.abort() : undefined;
    if (signal && abortHandler) {
      signal.addEventListener("abort", abortHandler, { once: true });
    }
    let result;
    try {
      // @ts-ignore
      result = await this.client.chat(request);
    } catch (error) {
      this.rethrowAsSmolError(error);
    } finally {
      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
    }

    this.logger.debug("Response from Ollama:", JSON.stringify(result, null, 2));
    this.statelogClient?.promptResponse(result as any);

    const output = result.message?.content || null;
    const toolCalls: ToolCall[] = [];
    if (result.message?.tool_calls) {
      for (const tc of result.message.tool_calls) {
        const tool_call = tc as OllamaToolCall & { id: string };
        toolCalls.push(
          new ToolCall(
            tool_call.id,
            tool_call.function.name,
            tool_call.function.arguments || {},
          ),
        );
      }
    }

    // Extract usage and calculate cost
    const { usage, cost } = this.calculateUsageAndCost(result);

    // Return the response, updating the chat history
    return success({ output, toolCalls, usage, cost, model: this.getModel() });
  }

  async *_textStream(config: SmolConfig): AsyncGenerator<StreamChunk> {
    const messages = config.messages.map((msg) => msg.toOpenAIMessage());

    const tools = (config.tools || []).map((tool) => {
      return zodToGoogleTool(tool.name, tool.schema, {
        description: tool.description,
      });
    });

    const request: ChatRequest = {
      messages: messages as Message[],
      model: this.getModel(),
      stream: true,
    };
    if (tools.length > 0) {
      request.tools = tools.map((t) => ({ type: "function", function: t }));
    }
    if (config.responseFormat) {
      request.format = config.responseFormat.toJSONSchema();
    }
    Object.assign(request, sanitizeAttributes(config.rawAttributes));

    this.logger.debug(
      "Sending streaming request to Ollama:",
      JSON.stringify(request, null, 2),
    );
    this.statelogClient?.promptRequest(request as any);

    const signal = this.getAbortSignal(config);
    const abortHandler = signal ? () => this.client.abort() : undefined;
    if (signal && abortHandler) {
      signal.addEventListener("abort", abortHandler, { once: true });
    }
    try {
      // @ts-ignore
      const stream = await this.client.chat(request);

      let content = "";
      const toolCallsMap = new Map<
        string,
        { id: string; name: string; arguments: any }
      >();
      let usage: TokenUsage | undefined;
      let cost: CostEstimate | undefined;
      let lastChunk: any;

      for await (const chunk of stream) {
        lastChunk = chunk;
        // Handle text content
        if (chunk.message?.content) {
          content += chunk.message.content;
          yield { type: "text", text: chunk.message.content };
        }

        // Handle tool calls
        if (chunk.message?.tool_calls) {
          for (const tc of chunk.message.tool_calls) {
            const tool_call = tc as OllamaToolCall & { id: string };
            const id = tool_call.id || tool_call.function.name || "";
            const name = tool_call.function.name || "";

            if (!toolCallsMap.has(id)) {
              toolCallsMap.set(id, {
                id: id,
                name: name,
                arguments: tool_call.function.arguments || {},
              });
            } else {
              // Merge arguments if tool call is split across chunks
              const existing = toolCallsMap.get(id)!;
              if (tool_call.function.arguments) {
                existing.arguments = {
                  ...existing.arguments,
                  ...tool_call.function.arguments,
                };
              }
            }
          }
        }
      }

      this.logger.debug("Streaming response completed from Ollama");

      // Extract usage from the last chunk
      if (lastChunk) {
        const usageAndCost = this.calculateUsageAndCost(lastChunk);
        usage = usageAndCost.usage;
        cost = usageAndCost.cost;
      }
      this.statelogClient?.promptResponse({ content, usage, cost });

      // Yield tool calls
      const toolCalls: ToolCall[] = [];
      for (const tc of toolCallsMap.values()) {
        const toolCall = new ToolCall(tc.id, tc.name, tc.arguments);
        toolCalls.push(toolCall);
        yield { type: "tool_call", toolCall };
      }

      yield {
        type: "done",
        result: {
          output: content || null,
          toolCalls,
          usage,
          cost,
          model: this.getModel(),
        },
      };
    } catch (error) {
      this.rethrowAsSmolError(error);
    } finally {
      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
    }
  }
}
