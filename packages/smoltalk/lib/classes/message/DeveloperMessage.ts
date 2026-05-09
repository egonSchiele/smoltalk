import { z } from "zod";
import { BaseMessage, MessageClass } from "./BaseMessage.js";
import { TextPart, TextPartSchema } from "../../types.js";
import { ChatCompletionMessageParam } from "openai/resources";
import { Content } from "@google/genai";
import { Message } from "ollama";
import type { ResponseInputItem } from "openai/resources/responses/responses.js";

export const DeveloperMessageJSONSchema = z.object({
  role: z.literal("developer"),
  content: z.union([z.string(), z.array(TextPartSchema)]),
  name: z.string().optional(),
  rawData: z.any().optional(),
});

export type DeveloperMessageJSON = z.infer<typeof DeveloperMessageJSONSchema>;

export class DeveloperMessage extends BaseMessage implements MessageClass {
  public _role = "developer" as const;
  public _content: string | Array<TextPart>;
  public _name?: string;
  public _rawData?: any;

  constructor(
    content: string | Array<TextPart>,
    options: { name?: string; rawData?: any } = {},
  ) {
    super();
    this._content = content;
    this._name = options.name;
    this._rawData = options.rawData;
  }

  get content(): string {
    return this.contentToString(this._content);
  }

  set content(value: string) {
    this._content = value;
  }

  get role() {
    return this._role;
  }

  get name(): string | undefined {
    return this._name;
  }

  get rawData(): any {
    return this._rawData;
  }

  toJSON(): DeveloperMessageJSON {
    return {
      role: this.role,
      content: this._content,
      name: this.name,
    };
  }

  static fromJSON(json: unknown): DeveloperMessage {
    const result = DeveloperMessageJSONSchema.safeParse(json);
    if (!result.success) {
      console.error("Failed to parse DeveloperMessage");
      console.error(JSON.stringify(json, null, 2));
      console.error(z.prettifyError(result.error));
      throw new Error("Failed to parse DeveloperMessage");
    }
    return new DeveloperMessage(result.data.content, {
      name: result.data.name,
      rawData: result.data.rawData,
    });
  }

  toOpenAIMessage(): ChatCompletionMessageParam {
    return { role: this.role, content: this.content, name: this.name };
  }

  toOpenAIResponseInputItem(): ResponseInputItem {
    return {
      type: "message",
      role: "developer",
      content: this.content,
    } as ResponseInputItem;
  }

  toGoogleMessage(): Content {
    return { role: this.role, parts: [{ text: this.content }] };
  }

  toOllamaMessage(): Message {
    return { role: this.role, content: this.content };
  }

  // Developer messages are treated like system messages in Anthropic's API.
  // Returns null to signal they should be collected into the `system` param.
  toAnthropicMessage(): null {
    return null;
  }
}
