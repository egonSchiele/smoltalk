import { Content, GenerateContentConfig, GoogleGenAI } from "@google/genai";
import { EgonLog } from "egonlog";
import { ToolCall } from "../classes/ToolCall.js";
import { getLogger } from "../logger.js";
import {
  BaseClientConfig,
  PromptConfig,
  PromptResult,
  Result,
  SmolClient,
  StreamChunk,
  ThinkingBlock,
  addCosts,
  addTokenUsage,
  success,
} from "../types.js";
import { zodToGoogleTool } from "../util/tool.js";
import { BaseClient } from "./baseClient.js";
import { ModelName } from "../models.js";
import { CostEstimate, TokenUsage } from "../types.js";
import { Model } from "../model.js";
import { userMessage } from "../classes/message/index.js";

export type SmolGoogleConfig = BaseClientConfig;
type GeneratedRequest = {
  contents: Content[];
  model: ModelName;
  config: GenerateContentConfig;
};
export class SmolGoogle extends BaseClient implements SmolClient {
  private client: GoogleGenAI;
  private logger: EgonLog;
  private model: Model;
  constructor(config: SmolGoogleConfig) {
    super(config);
    if (!config.googleApiKey) {
      throw new Error("Google API key is required for SmolGoogle client.");
    }
    this.client = new GoogleGenAI({ apiKey: config.googleApiKey });
    this.logger = getLogger();
    this.model = new Model(config.model);
  }

  getClient() {
    return this.client;
  }

  getModel(): ModelName {
    return this.model.getResolvedModel();
  }

  private calculateUsageAndCost(usageMetadata: any): {
    usage?: TokenUsage;
    cost?: CostEstimate;
  } {
    let usage: TokenUsage | undefined;
    let cost: CostEstimate | undefined;

    if (usageMetadata) {
      usage = {
        inputTokens: usageMetadata.promptTokenCount || 0,
        outputTokens: usageMetadata.candidatesTokenCount || 0,
        cachedInputTokens: usageMetadata.cachedContentTokenCount,
        totalTokens: usageMetadata.totalTokenCount,
      };
      const calculatedCost = this.model.calculateCost(usage);
      if (calculatedCost) {
        cost = calculatedCost;
      }
    }

    return { usage, cost };
  }

  private buildRequest(config: PromptConfig): GeneratedRequest {
    // Google Gemini only supports "user" and "model" roles in the contents
    // array. System and developer messages must be passed via systemInstruction.
    const systemParts: string[] = [];
    const contentMessages = config.messages.filter((msg) => {
      if (msg.role === "system" || msg.role === "developer") {
        systemParts.push(msg.content);
        return false;
      }
      return true;
    });
    const messages = contentMessages.map((msg) => msg.toGoogleMessage());

    const tools = (config.tools || []).map((tool) => {
      return zodToGoogleTool(tool.name, tool.schema, {
        description: tool.description,
      });
    });

    const genConfig: GenerateContentConfig = {};

    if (systemParts.length > 0) {
      genConfig.systemInstruction = systemParts.join("\n");
    }

    if (tools.length > 0) {
      genConfig.tools = [{ functionDeclarations: tools }];
    }

    if (config.responseFormat) {
      genConfig.responseMimeType = "application/json";
      genConfig.responseJsonSchema = config.responseFormat.toJSONSchema();
    }

    if (!config.thinking?.enabled && config.reasoningEffort) {
      const budgetMap = { low: 2048, medium: 8192, high: 16384 } as const;
      genConfig.thinkingConfig = {
        thinkingBudget: budgetMap[config.reasoningEffort],
      };
    }

    return {
      contents: messages,
      model: this.getModel(),
      config: genConfig,
      ...(config.rawAttributes || {}),
    };
  }

  async _textSync(config: PromptConfig): Promise<Result<PromptResult>> {
    const signal = this.getAbortSignal(config);
    const request = {
      ...this.buildRequest(config),
      stream: config.stream || false,
    };
    if (signal) {
      request.config = { ...request.config, abortSignal: signal };
    }
    const hasTools = config.tools && config.tools.length > 0;
    const hasStructuredResponse = !!config.responseFormat;
    if (!(hasTools && hasStructuredResponse)) {
      // Unless we have both tools and structured response,
      // we can make a single request and return immediately
      return this.__textSync(request);
    }

    // Google Gemini does not support combining function calling with
    // responseMimeType 'application/json'. When tools are present, we
    // make two requests instead
    /*********** TOOL CALL REQUEST ************/
    this.logger.debug(
      "Detected both tool calls and structured response in call to Google Gemini. Making separate request to Google Gemini for tool calls.",
    );
    this.statelogClient?.debug(
      "Detected both tool calls and structured response in call to Google Gemini. Making separate request to Google Gemini for tool calls.",
      {
        contents: request.contents,
        tools: config.tools,
        responseFormat: config.responseFormat,
      },
    );
    const toolRequest = {
      ...request,
      config: {
        ...request.config,
        responseMimeType: undefined,
        responseJsonSchema: undefined,
      },
    };
    const toolResult = await this.__textSync(toolRequest);
    if (!toolResult.success) {
      return toolResult;
    }
    if (toolResult.value.toolCalls.length > 0) {
      this.logger.debug(
        "Tool calls detected. Returning tool calls without making second request for structured response.",
      );
      this.statelogClient?.debug(
        "Tool calls detected in Google Gemini response, skipping structured response request",
        {
          toolCalls: toolResult.value.toolCalls,
        },
      );
      return toolResult;
    }
    if (!toolResult.value.output) {
      this.statelogClient?.debug(
        "No output or tool calls detected in Google Gemini response",
        {
          response: toolResult.value,
        },
      );
      throw new Error(
        "No output or tool calls detected in Google Gemini response. This should not happen.",
      );
    }

    this.logger.debug(
      "No tool calls detected. Making second request to Google Gemini for structured response.",
    );
    this.statelogClient?.debug(
      "No tool calls detected in Google Gemini response. Making second request for structured response.",
      {
        response: toolResult.value,
      },
    );

    /*********** STRUCTURED OUTPUT REQUEST ************/
    const message = userMessage(
      `Please return this output in the specified structured format. Output: ${toolResult.value.output}`,
    );
    const messages = [message.toGoogleMessage()];

    const responseRequest = {
      ...request,
      config: {
        ...request.config,
        tools: undefined,
      },
      messages,
    };
    const responseResult = await this.__textSync(responseRequest);
    if (!responseResult.success) {
      return responseResult;
    }
    const thinkingBlocks = [
      ...(toolResult.value.thinkingBlocks || []),
      ...(responseResult.value.thinkingBlocks || []),
    ];

    return success({
      output: responseResult.value.output,
      // if there were tool calls, we would have returned already, so we know these are empty
      toolCalls: [],
      ...(thinkingBlocks.length > 0 && { thinkingBlocks }),
      usage: addTokenUsage(toolResult.value.usage, responseResult.value.usage),
      cost: addCosts(toolResult.value.cost, responseResult.value.cost),
      model: request.model as ModelName,
    });
  }

  async __textSync(request: GeneratedRequest): Promise<Result<PromptResult>> {
    this.logger.debug(
      "Sending request to Google Gemini:",
      JSON.stringify(request, null, 2),
    );
    this.statelogClient?.promptRequest(request as any);
    // Send the prompt as the latest message
    const result = await this.client.models.generateContent(request);

    this.logger.debug(
      "Response from Google Gemini:",
      JSON.stringify(result, null, 2),
    );
    this.statelogClient?.promptResponse(result as any);

    const output = result.text || null;
    const toolCalls: ToolCall[] = [];
    const thinkingBlocks: ThinkingBlock[] = [];

    result.candidates?.forEach((candidate) => {
      if (candidate.content && candidate.content.parts) {
        candidate.content.parts.forEach((part: any) => {
          if (part.functionCall) {
            const functionCall = part.functionCall;
            toolCalls.push(
              new ToolCall("", functionCall.name, functionCall.args),
            );
          }
          // Capture thought parts (thought: true indicates a thinking part)
          if (part.thoughtSignature) {
            thinkingBlocks.push({
              text: part.text || "",
              signature: part.thoughtSignature,
            });
          }
        });
      }
    });

    // Extract usage and calculate cost
    const { usage, cost } = this.calculateUsageAndCost(result.usageMetadata);

    // Return the response, updating the chat history
    return success({
      output,
      toolCalls,
      ...(thinkingBlocks.length > 0 && { thinkingBlocks }),
      usage,
      cost,
      model: request.model as ModelName,
    });
  }

  async *_textStream(config: PromptConfig): AsyncGenerator<StreamChunk> {
    const signal = this.getAbortSignal(config);
    const request = this.buildRequest(config);
    if (signal) {
      request.config = { ...request.config, abortSignal: signal };
    }

    const hasTools = config.tools && config.tools.length > 0;
    const hasStructuredResponse = !!config.responseFormat;
    if (hasTools && hasStructuredResponse) {
      this.logger.debug(
        "Gemini does not support streaming responses with both tool calls and structured response formats. Response format will be ignored.",
      );
      this.statelogClient?.debug(
        "Google Gemini: streaming with tools + structured response not supported, ignoring response format",
        {},
      );
      request.config.responseMimeType = undefined;
      request.config.responseJsonSchema = undefined;
    }

    this.logger.debug(
      "Sending streaming request to Google Gemini:",
      JSON.stringify(request, null, 2),
    );
    this.statelogClient?.promptRequest(request as any);

    const stream = await this.client.models.generateContentStream(request);

    let content = "";
    const toolCallsMap = new Map<
      string,
      { id: string; name: string; arguments: any }
    >();
    const thinkingBlocks: ThinkingBlock[] = [];
    let usage: TokenUsage | undefined;
    let cost: CostEstimate | undefined;

    for await (const chunk of stream) {
      // Extract usage metadata from chunks
      if (chunk.usageMetadata) {
        const usageAndCost = this.calculateUsageAndCost(chunk.usageMetadata);
        usage = usageAndCost.usage;
        cost = usageAndCost.cost;
      }

      // Iterate raw parts to capture thought signatures and regular content
      for (const candidate of (chunk as any).candidates || []) {
        for (const part of candidate?.content?.parts || []) {
          const p = part as any;

          if (p.thoughtSignature) {
            const block: ThinkingBlock = {
              text: p.text || "",
              signature: p.thoughtSignature,
            };
            thinkingBlocks.push(block);
            yield {
              type: "thinking",
              text: block.text,
              signature: block.signature,
            };
          } else if (p.text) {
            content += p.text;
            yield { type: "text", text: p.text };
          } else if (p.functionCall) {
            const id = p.functionCall.id || p.functionCall.name || "";
            const name = p.functionCall.name || "";
            if (!toolCallsMap.has(id)) {
              toolCallsMap.set(id, {
                id,
                name,
                arguments: p.functionCall.args,
              });
            }
          }
        }
      }
    }

    this.logger.debug("Streaming response completed from Google Gemini");
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
        ...(thinkingBlocks.length > 0 && { thinkingBlocks }),
        usage,
        cost,
        model: request.model as ModelName,
      },
    };
  }
}
