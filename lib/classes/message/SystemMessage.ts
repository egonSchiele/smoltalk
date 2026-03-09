import { z } from "zod";
import { BaseMessage, MessageClass } from "./BaseMessage.js";
import { TextPart, TextPartSchema } from "../../types.js";
import { ChatCompletionMessageParam } from "openai/resources";
import { Content } from "@google/genai";
import { Message } from "ollama";
import type { ResponseInputItem } from "openai/resources/responses/responses.js";

export const SystemMessageJSONSchema = z.object({
  role: z.literal("system"),
  content: z.union([z.string(), z.array(TextPartSchema)]),
  name: z.string().optional(),
  rawData: z.any().optional(),
});

export type SystemMessageJSON = z.infer<typeof SystemMessageJSONSchema>;

export class SystemMessage extends BaseMessage implements MessageClass {
  public _role = "system" as const;
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
    return typeof this._content === "string"
      ? this._content
      : JSON.stringify(this._content);
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

  toJSON(): SystemMessageJSON {
    return {
      role: this.role,
      content: this._content,
      name: this.name,
    };
  }

  static fromJSON(json: unknown): SystemMessage {
    const parsed = SystemMessageJSONSchema.parse(json);
    return new SystemMessage(parsed.content, {
      name: parsed.name,
      rawData: parsed.rawData,
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

  // System messages are passed as the top-level `system` param in Anthropic's API,
  // not as entries in the messages array. Returns null to signal this.
  toAnthropicMessage(): null {
    return null;
  }
}
