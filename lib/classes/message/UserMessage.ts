import { ContentListUnion } from "@google/genai";
import { z } from "zod";
import { BaseMessage, MessageClass } from "./BaseMessage.js";
import { ChatCompletionMessageParam } from "openai/resources";
import { Content } from "@google/genai";
import { ToolCall } from "../ToolCall.js";
import { Message } from "ollama";
import type { ResponseInputItem } from "openai/resources/responses/responses.js";

export const UserMessageJSONSchema = z.object({
  role: z.literal("user"),
  content: z.string(),
  name: z.string().optional(),
  rawData: z.any().optional(),
});

export type UserMessageJSON = z.infer<typeof UserMessageJSONSchema>;

export class UserMessage extends BaseMessage implements MessageClass {
  public _role = "user" as const;
  public _content: string;
  public _name?: string;
  public _rawData?: any;

  constructor(content: string, options: { name?: string; rawData?: any } = {}) {
    super();
    this._content = content;
    this._name = options.name;
    this._rawData = options.rawData;
  }

  get content(): string {
    return this._content;
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

  toJSON(): UserMessageJSON {
    return {
      role: this.role,
      content: this.content,
      name: this.name,
    };
  }

  static fromJSON(json: unknown): UserMessage {
    const result = UserMessageJSONSchema.safeParse(json);
    if (!result.success) {
      console.error("Failed to parse UserMessage");
      console.error(JSON.stringify(json, null, 2));
      console.error(z.prettifyError(result.error));
      throw new Error("Failed to parse UserMessage");
    }
    return new UserMessage(result.data.content, {
      name: result.data.name,
      rawData: result.data.rawData,
    });
  }

  toOpenAIMessage(): ChatCompletionMessageParam {
    return {
      role: this.role,
      content: this.content,
      name: this.name,
    };
  }

  toOpenAIResponseInputItem(): ResponseInputItem {
    return {
      type: "message",
      role: "user",
      content: this.content,
    } as ResponseInputItem;
  }

  toGoogleMessage(): Content {
    return { role: this.role, parts: [{ text: this.content }] };
  }

  toOllamaMessage(): Message {
    return {
      role: this.role,
      content: this.content,
    };
  }

  toAnthropicMessage(): { role: "user"; content: string } {
    return { role: "user", content: this.content };
  }
}
