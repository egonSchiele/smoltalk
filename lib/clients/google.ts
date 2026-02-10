import { GenerateContentConfig, GoogleGenAI } from "@google/genai";
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
  success,
} from "../types.js";
import { zodToGoogleTool } from "../util/tool.js";
import { BaseClient } from "./baseClient.js";
import { calculateCost, ModelName } from "../models.js";
import { CostEstimate, TokenUsage } from "../types.js";

export type SmolGoogleConfig = BaseClientConfig;

export class SmolGoogle extends BaseClient implements SmolClient {
  private client: GoogleGenAI;
  private logger: EgonLog;
  private model: string;
  constructor(config: SmolGoogleConfig) {
    super(config);
    if (!config.googleApiKey) {
      throw new Error("Google API key is required for SmolGoogle client.");
    }
    this.client = new GoogleGenAI({ apiKey: config.googleApiKey });
    this.logger = getLogger();
    this.model = config.model;
  }

  getClient() {
    return this.client;
  }

  getModel() {
    return this.model;
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

      const calculatedCost = calculateCost(this.model as ModelName, usage);
      if (calculatedCost) {
        cost = calculatedCost;
      }
    }

    return { usage, cost };
  }

  private buildRequest(config: PromptConfig) {
    const messages = config.messages.map((msg) => msg.toGoogleMessage());

    const tools = (config.tools || []).map((tool) => {
      return zodToGoogleTool(tool.name, tool.schema, {
        description: tool.description,
      });
    });

    const genConfig: GenerateContentConfig = {};

    if (tools.length > 0) {
      genConfig.tools = [{ functionDeclarations: tools }];
    }
    if (config.responseFormat) {
      genConfig.responseMimeType = "application/json";
      genConfig.responseJsonSchema = config.responseFormat.toJSONSchema();
    }

    return {
      contents: messages,
      model: this.model,
      config: genConfig,
      ...(config.rawAttributes || {}),
    };
  }

  async _textSync(config: PromptConfig): Promise<Result<PromptResult>> {
    const request = {
      ...this.buildRequest(config),
      stream: config.stream || false,
    };

    this.logger.debug(
      "Sending request to Google Gemini:",
      JSON.stringify(request, null, 2),
    );
    // Send the prompt as the latest message
    const result = await this.client.models.generateContent(request);

    this.logger.debug(
      "Response from Google Gemini:",
      JSON.stringify(result, null, 2),
    );

    const output = result.text || null;
    const toolCalls: ToolCall[] = [];

    result.candidates?.forEach((candidate) => {
      if (candidate.content && candidate.content.parts) {
        candidate.content.parts.forEach((part: any) => {
          if (part.functionCall) {
            const functionCall = part.functionCall;
            toolCalls.push(
              new ToolCall("", functionCall.name, functionCall.args),
            );
          }
        });
      }
    });

    // Extract usage and calculate cost
    const { usage, cost } = this.calculateUsageAndCost(result.usageMetadata);

    // Return the response, updating the chat history
    return success({ output, toolCalls, usage, cost });
  }

  async *_textStream(config: PromptConfig): AsyncGenerator<StreamChunk> {
    const request = this.buildRequest(config);

    this.logger.debug(
      "Sending streaming request to Google Gemini:",
      JSON.stringify(request, null, 2),
    );

    const stream = await this.client.models.generateContentStream(request);

    let content = "";
    const toolCallsMap = new Map<
      string,
      { id: string; name: string; arguments: any }
    >();
    let usage: TokenUsage | undefined;
    let cost: CostEstimate | undefined;

    for await (const chunk of stream) {
      // Extract usage metadata from chunks
      if (chunk.usageMetadata) {
        const usageAndCost = this.calculateUsageAndCost(chunk.usageMetadata);
        usage = usageAndCost.usage;
        cost = usageAndCost.cost;
      }

      // Handle text content
      if (chunk.text) {
        content += chunk.text;
        yield { type: "text", text: chunk.text };
      }

      // Handle function calls
      if (chunk.functionCalls) {
        for (const functionCall of chunk.functionCalls) {
          const id = functionCall.id || functionCall.name || "";
          const name = functionCall.name || "";
          if (!toolCallsMap.has(id)) {
            toolCallsMap.set(id, {
              id: id,
              name: name,
              arguments: functionCall.args,
            });
          }
        }
      }
    }

    this.logger.debug("Streaming response completed from Google Gemini");

    // Yield tool calls
    const toolCalls: ToolCall[] = [];
    for (const tc of toolCallsMap.values()) {
      const toolCall = new ToolCall(tc.id, tc.name, tc.arguments);
      toolCalls.push(toolCall);
      yield { type: "tool_call", toolCall };
    }

    yield {
      type: "done",
      result: { output: content || null, toolCalls, usage, cost },
    };
  }
}
