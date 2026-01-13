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
  success,
} from "../types.js";
import { zodToGoogleTool } from "../util/tool.js";
import { BaseClient } from "./baseClient.js";

export type SmolGoogleConfig = BaseClientConfig;

export class SmolGoogle extends BaseClient implements SmolClient {
  private client: GoogleGenAI;
  private logger: EgonLog;
  private model: string;
  constructor(config: SmolGoogleConfig) {
    super();
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

  async text(config: PromptConfig): Promise<Result<PromptResult>> {
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

    const request = {
      contents: messages,
      model: this.model,
      config: genConfig,
    };
    if (config.rawAttributes) {
      Object.assign(request, config.rawAttributes);
    }

    this.logger.debug(
      "Sending request to Google Gemini:",
      JSON.stringify(request, null, 2)
    );
    // Send the prompt as the latest message
    const result = await this.client.models.generateContent(request);

    this.logger.debug(
      "Response from Google Gemini:",
      JSON.stringify(result, null, 2)
    );

    const text = result.text || null;
    const toolCalls: ToolCall[] = [];

    result.candidates?.forEach((candidate) => {
      if (candidate.content && candidate.content.parts) {
        candidate.content.parts.forEach((part: any) => {
          if (part.functionCall) {
            const functionCall = part.functionCall;
            toolCalls.push(
              new ToolCall("", functionCall.name, functionCall.args)
            );
          }
        });
      }
    });

    // Return the response, updating the chat history
    return success({ output: text, toolCalls });
  }
}
