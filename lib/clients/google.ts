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
  ThinkingBlock,
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
    // Google Gemini does not support combining function calling with
    // responseMimeType 'application/json'. When tools are present, skip
    // setting the JSON response format — the BaseClient's textWithRetry
    // will still validate/parse the response against the schema.
    if (config.responseFormat && tools.length === 0) {
      genConfig.responseMimeType = "application/json";
      genConfig.responseJsonSchema = config.responseFormat.toJSONSchema();
    }

    if (!config.thinking?.enabled && config.reasoningEffort) {
      const budgetMap = { low: 2048, medium: 8192, high: 16384 } as const;
      genConfig.thinkingConfig = { thinkingBudget: budgetMap[config.reasoningEffort] };
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
            yield { type: "thinking", text: block.text, signature: block.signature };
          } else if (p.text) {
            content += p.text;
            yield { type: "text", text: p.text };
          } else if (p.functionCall) {
            const id = p.functionCall.id || p.functionCall.name || "";
            const name = p.functionCall.name || "";
            if (!toolCallsMap.has(id)) {
              toolCallsMap.set(id, { id, name, arguments: p.functionCall.args });
            }
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
