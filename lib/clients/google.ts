import { GoogleGenAI } from "@google/genai";
import { EgonLog } from "egonlog";
import { getLogger } from "../logger.js";
import {
  BaseClientConfig,
  PromptConfig,
  PromptResult,
  Result,
  SmolClient,
  success,
} from "../types.js";
import { BaseClient } from "./baseClient.js";

export type SmolGoogleConfig = BaseClientConfig;

export class SmolGoogle extends BaseClient implements SmolClient {
  private client: GoogleGenAI;
  private logger: EgonLog;
  private model: string;
  constructor(config: SmolGoogleConfig) {
    super();
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
    this.logger = getLogger();
    this.model = config.model;
  }

  getClient() {
    return this.client;
  }

  async text(config: PromptConfig): Promise<Result<PromptResult>> {
    const messages = config.messages.map((msg) => msg.toGoogleMessage());

    // Send the prompt as the latest message
    const result = await this.client.models.generateContent({
      contents: messages,
      model: this.model,
    });
    //console.log("Full response:", JSON.stringify(result, null, 2));
    const text = result.text || null;

    // Return the response, updating the chat history
    return success({ output: text, toolCalls: [] });
  }
}
