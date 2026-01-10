import { ContentListUnion } from "@google/genai";
import { BaseMessage, MessageClass } from "./BaseMessage.js";
import { ChatCompletionMessageParam } from "openai/resources";
import { Content } from "@google/genai";
import { ToolCall } from "../ToolCall.js";

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

  get role() {
    return this._role;
  }

  get name(): string | undefined {
    return this._name;
  }

  get rawData(): any {
    return this._rawData;
  }

  toJSON() {
    return {
      role: this.role,
      content: this.content,
      name: this.name,
    };
  }

  toOpenAIMessage(): ChatCompletionMessageParam {
    return {
      role: this.role,
      content: this.content,
      name: this.name,
    };
  }

  toGoogleMessage(): Content {
    return { role: this.role, parts: [{ text: this.content }] };
  }
}
