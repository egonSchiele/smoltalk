// @ts-nocheck
import { GoogleGenAI, Content, Part } from "@google/genai";
import {
  BaseClientConfig,
  PromptConfig,
  PromptResult,
  Result,
  success,
} from "../types.js";
import { EgonLog } from "egonlog";

export type SmolGoogleConfig = BaseClientConfig;

export class SmolGoogle implements SmolClient {
  private client: GoogleGenAI;
  private logger: EgonLog;
  private model: string;
  constructor(config: SmolGoogleConfig) {
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
    this.logger = config.logger;
    this.model = config.model;
  }

  getClient() {
    return this.client;
  }

  async text(
    content: string,
    config?: PromptConfig
  ): Promise<Result<PromptResult>> {
    const messages = structuredClone(config?.messages) || [];
    messages.push({ role: "user", content });

    /*   const contents = messages.map((message) => ({
    role: message.role === "user" ? "user" : "model", // Use consistent roles
    parts: [makePart(message)] as Part[],
  }));

  role: "user",
  parts: [{ text: sanitizedPrompt }],
});
  contents.push({
*/

    // Send the prompt as the latest message
    const result = await this.client.models.generateContent({
      contents: content,
      model: this.model,
    });
    //console.log("Full response:", JSON.stringify(result, null, 2));
    const text = result.text;

    // Return the response, updating the chat history
    return success({ output: result.text, toolCalls: [] });
  }
}
