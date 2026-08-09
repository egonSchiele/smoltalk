import OpenAI from "openai";
import {
  PromptResult,
  Result,
  SmolClient,
  SmolConfig,
  StreamChunk,
  success,
} from "../types.js";
import { EgonLog } from "../util/logger.js";
import { ToolCall } from "../classes/ToolCall.js";
import { getLogger } from "../util/logger.js";
import { redactAttachments } from "../util/redact.js";
import { BaseClient } from "./baseClient.js";
import { zodToOpenAIResponsesTool } from "../util/tool.js";
import { responseFormatToJsonSchema } from "../util/jsonSchema.js";
import { normalizeOpenAIResponsesStopReason } from "../util/stopReason.js";
import { sanitizeAttributes } from "../util/util.js";
import { ModelName } from "../models.js";
import { CostEstimate, TokenUsage, HostedToolResult, WebSearchSource, WebSearchCitation } from "../types.js";
import { WEB_SEARCH, webSearchResult, applyHostedToolCost } from "../util/hostedTools.js";
import type {
  ResponseInputItem,
  ResponseStreamEvent,
} from "openai/resources/responses/responses.js";
import { Model } from "../model.js";
import {
  SmolContentPolicyError,
  SmolContextWindowExceededError,
  smolErrorForStatus,
} from "../smolError.js";
import { extractHttpErrorFields } from "../util/httpError.js";

export type SmolOpenAiResponsesConfig = SmolConfig;

export function openaiResponsesWebSearchEntries(hostedTools?: string[]): any[] {
  if (hostedTools && hostedTools.includes(WEB_SEARCH)) {
    return [{ type: "web_search" }];
  }
  return [];
}

export function parseOpenAIResponsesHostedTools(
  response: any,
  provider: string,
): HostedToolResult[] {
  const queries: string[] = [];
  const sources: WebSearchSource[] = [];
  const citations: WebSearchCitation[] = [];
  const raw: any[] = [];
  let callCount = 0;
  for (const item of response.output || []) {
    if (item.type === "web_search_call") {
      raw.push(item);
      callCount += 1;
      // action.query is present for `search` actions but not always (e.g. open_page).
      const query = item.action?.query;
      if (typeof query === "string") {
        queries.push(query);
      }
    } else if (item.type === "message") {
      for (const part of item.content || []) {
        for (const ann of part.annotations || []) {
          if (ann.type === "url_citation" && typeof ann.url === "string") {
            citations.push({ url: ann.url, title: ann.title, startIndex: ann.start_index, endIndex: ann.end_index });
            sources.push({ url: ann.url, title: ann.title });
          }
        }
      }
    }
  }
  if (callCount === 0 && citations.length === 0) {
    return [];
  }
  return [webSearchResult(provider, { queries, sources, citations, callCount, raw })];
}

export class SmolOpenAiResponses extends BaseClient implements SmolClient {
  private client: OpenAI;
  private logger: EgonLog;
  private model: Model;

  constructor(config: SmolOpenAiResponsesConfig) {
    super(config);
    const apiKey = config.apiKey?.openAi || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OpenAI API key is required for SmolOpenAiResponses client.",
      );
    }
    this.client = new OpenAI({ apiKey });
    this.logger = getLogger();
    this.model = new Model(config.model, config.provider, config.modelData);
  }

  getClient() {
    return this.client;
  }

  getModel(): ModelName {
    return this.model.getModel();
  }

  private convertMessages(config: SmolConfig): {
    instructions: string | undefined;
    input: ResponseInputItem[];
  } {
    const systemParts: string[] = [];
    const input: ResponseInputItem[] = [];

    config.messages.forEach((msg) => {
      if (msg.role === "system" || msg.role === "developer") {
        // Collect all system/developer messages as instructions
        systemParts.push(msg.content);
        return;
      }

      // Use the message's toOpenAIResponseInputItem method
      const items = msg.toOpenAIResponseInputItem();
      if (Array.isArray(items)) {
        input.push(...items);
      } else {
        input.push(items);
      }
    });

    const instructions =
      systemParts.length > 0 ? systemParts.join("\n\n") : undefined;

    return { instructions, input };
  }

  private buildRequest(config: SmolConfig) {
    const { instructions, input } = this.convertMessages(config);

    const request: {
      model: string;
      input: ResponseInputItem[];
      instructions?: string;
      tools?: any[];
      temperature?: number;
      max_output_tokens?: number;
      parallel_tool_calls?: boolean;
      text?: any;
      [key: string]: any;
    } = {
      model: this.getModel(),
      input,
    };

    if (instructions) {
      request.instructions = instructions;
    }

    if (config.tools && config.tools.length > 0) {
      request.tools = config.tools.map((tool) =>
        zodToOpenAIResponsesTool(tool.name, tool.schema, {
          description: tool.description,
        }),
      );
    }

    const hostedEntries = openaiResponsesWebSearchEntries(config.hostedTools);
    if (hostedEntries.length > 0) {
      const existing = Array.isArray(request.tools) ? request.tools : [];
      request.tools = [...existing, ...hostedEntries];
    }

    if (config.temperature !== undefined) {
      request.temperature = config.temperature;
    }

    if (config.maxTokens !== undefined) {
      request.max_output_tokens = config.maxTokens;
    }

    if (config.parallelToolCalls !== undefined) {
      request.parallel_tool_calls = config.parallelToolCalls;
    }

    if (config.responseFormat) {
      request.text = {
        format: {
          type: "json_schema",
          name: config.responseFormatOptions?.name || "response",
          schema: responseFormatToJsonSchema(config.responseFormat),
        },
      };
    }

    if (config.reasoningEffort) {
      request.reasoning = { effort: config.reasoningEffort };
    }

    Object.assign(request, sanitizeAttributes(config.rawAttributes));

    return request;
  }

  private calculateUsageAndCost(usageData: any): {
    usage?: TokenUsage;
    cost?: CostEstimate;
  } {
    let usage: TokenUsage | undefined;
    let cost: CostEstimate | undefined;

    if (usageData) {
      const cached = usageData.input_tokens_details?.cached_tokens ?? 0;
      usage = {
        inputTokens: Math.max(0, (usageData.input_tokens || 0) - cached),
        outputTokens: usageData.output_tokens || 0,
        totalTokens: usageData.total_tokens,
      };
      if (cached > 0) {
        usage.cachedInputTokens = cached;
      }

      const calculatedCost = this.model.calculateCost(usage);
      if (calculatedCost) {
        cost = calculatedCost;
      }
    }

    return { usage, cost };
  }

  private rethrowAsSmolError(error: unknown): never {
    if (error instanceof OpenAI.APIError) {
      const http = { ...extractHttpErrorFields(error), cause: error };
      if (error.code === "context_length_exceeded") {
        throw new SmolContextWindowExceededError(error.message, http);
      }
      if (error.code === "content_policy_violation") {
        throw new SmolContentPolicyError(error.message, http);
      }
      throw smolErrorForStatus(error.message, http);
    }
    throw error;
  }

  async _textSync(config: SmolConfig): Promise<Result<PromptResult>> {
    const request = this.buildRequest(config);

    this.logger.debug(
      "Sending request to OpenAI Responses API:",
      JSON.stringify(redactAttachments(request), null, 2),
    );
    this.statelogClient?.promptRequest(request);

    const signal = this.getAbortSignal(config);
    let response;
    try {
      response = await this.client.responses.create(
        {
          ...request,
          stream: false,
        },
        { ...(signal && { signal }) },
      );
    } catch (error) {
      this.rethrowAsSmolError(error);
    }

    this.logger.debug(
      "Response from OpenAI Responses API:",
      JSON.stringify(response, null, 2),
    );
    this.statelogClient?.promptResponse(response as any);

    const output = response.output_text || null;

    const toolCalls: ToolCall[] = [];
    for (const item of response.output) {
      if (item.type === "function_call") {
        toolCalls.push(new ToolCall(item.call_id, item.name, item.arguments));
      }
    }

    const { usage, cost } = this.calculateUsageAndCost(response.usage);
    const parsed = parseOpenAIResponsesHostedTools(response, "openai-responses");
    const { results: hostedToolResults, cost: finalCost } = applyHostedToolCost(
      parsed,
      cost,
      this.getModel(),
      this.config.modelData,
    );

    const incompleteReason = (response as any).incomplete_details?.reason;
    const rawStopReason = incompleteReason ?? response.status ?? undefined;

    const result: PromptResult = {
      output,
      toolCalls,
      usage,
      cost: finalCost,
      model: this.getModel(),
      stopReason: normalizeOpenAIResponsesStopReason(
        response.status,
        incompleteReason,
        toolCalls.length > 0,
      ),
    };
    if (rawStopReason) {
      result.rawStopReason = rawStopReason;
    }
    if (hostedToolResults.length > 0) {
      result.hostedToolResults = hostedToolResults;
    }
    return success(result);
  }

  async *_textStream(config: SmolConfig): AsyncGenerator<StreamChunk> {
    const request = this.buildRequest(config);

    this.logger.debug(
      "Sending streaming request to OpenAI Responses API:",
      JSON.stringify(redactAttachments(request), null, 2),
    );
    this.statelogClient?.promptRequest(request);

    const signal = this.getAbortSignal(config);
    let stream;
    try {
      stream = this.client.responses.stream(request, {
        ...(signal && { signal }),
      });
    } catch (error) {
      this.rethrowAsSmolError(error);
    }

    let content = "";
    const functionCalls = new Map<
      string,
      { name: string; arguments: string; call_id: string }
    >();
    let usage: TokenUsage | undefined;
    let cost: CostEstimate | undefined;
    let finalResponse: any;

    for await (const event of stream as AsyncIterable<ResponseStreamEvent>) {
      if (
        event.type === "response.completed" ||
        event.type === "response.incomplete"
      ) {
        finalResponse = (event as any).response;
      }
      switch (event.type) {
        case "response.output_text.delta": {
          content += event.delta;
          yield { type: "text", text: event.delta };
          break;
        }

        case "response.function_call_arguments.delta": {
          const existing = functionCalls.get(event.item_id);
          if (existing) {
            existing.arguments += event.delta;
          } else {
            functionCalls.set(event.item_id, {
              name: "",
              arguments: event.delta,
              call_id: "",
            });
          }
          break;
        }

        case "response.function_call_arguments.done": {
          const entry = functionCalls.get(event.item_id);
          if (entry) {
            entry.arguments = event.arguments;
            entry.name = event.name;
          } else {
            functionCalls.set(event.item_id, {
              name: event.name,
              arguments: event.arguments,
              call_id: "",
            });
          }
          break;
        }

        case "response.output_item.done": {
          if (event.item.type === "function_call") {
            const entry = functionCalls.get(event.item.id!);
            if (entry) {
              entry.call_id = event.item.call_id;
              entry.name = event.item.name;
            } else {
              functionCalls.set(event.item.id!, {
                name: event.item.name,
                arguments: event.item.arguments,
                call_id: event.item.call_id,
              });
            }
          }
          break;
        }

        case "response.completed": {
          const usageAndCost = this.calculateUsageAndCost(event.response.usage);
          usage = usageAndCost.usage;
          cost = usageAndCost.cost;
          break;
        }
      }
    }

    this.logger.debug("Streaming response completed from OpenAI Responses API");
    this.statelogClient?.promptResponse({ content, usage, cost });

    const toolCalls: ToolCall[] = [];
    for (const fc of functionCalls.values()) {
      const toolCall = new ToolCall(fc.call_id, fc.name, fc.arguments);
      toolCalls.push(toolCall);
      yield { type: "tool_call", toolCall };
    }

    const incompleteReason = finalResponse?.incomplete_details?.reason;
    const rawStopReason = incompleteReason ?? finalResponse?.status ?? undefined;

    const result: PromptResult = {
      output: content || null,
      toolCalls,
      usage,
      cost,
      model: this.getModel(),
      stopReason: normalizeOpenAIResponsesStopReason(
        finalResponse?.status,
        incompleteReason,
        toolCalls.length > 0,
      ),
    };
    if (rawStopReason) {
      result.rawStopReason = rawStopReason;
    }

    yield { type: "done", result };
  }
}
