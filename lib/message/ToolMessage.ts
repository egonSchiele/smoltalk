import { BaseMessage, MessageClass } from "./BaseMessage.js";
import { TextPart } from "../types.js";

export class ToolMessage extends BaseMessage implements MessageClass {
  public _role = "tool";
  public _content: string | Array<TextPart>;
  public _tool_call_id: string;
  public _rawData?: any;

  constructor(
    content: string | Array<TextPart>,
    options: { tool_call_id: string; rawData?: any }
  ) {
    super();
    this._content = content;
    this._tool_call_id = options.tool_call_id;
    this._rawData = options.rawData;
  }

  get content(): string {
    return typeof this._content === "string"
      ? this._content
      : JSON.stringify(this._content);
  }

  get role(): string {
    return this._role;
  }

  get name(): string | undefined {
    return undefined;
  }

  get tool_call_id(): string {
    return this._tool_call_id;
  }

  get rawData(): any {
    return this._rawData;
  }

  toOpenAIMessage(): { role: string; content: string; name?: string } {
    return { role: this.role, content: this.content };
  }

  toGoogleMessage(): { author: string; content: string } {
    return { author: this.role, content: this.content };
  }
}
