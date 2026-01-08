import { BaseMessage, MessageClass } from "./BaseMessage.js";
import { TextPart } from "../types.js";

export class DeveloperMessage extends BaseMessage implements MessageClass {
  public _role = "developer";
  public _content: string | Array<TextPart>;
  public _name?: string;
  public _rawData?: any;

  constructor(
    content: string | Array<TextPart>,
    options: { name?: string; rawData?: any } = {}
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

  get role(): string {
    return this._role;
  }

  get name(): string | undefined {
    return this._name;
  }

  get rawData(): any {
    return this._rawData;
  }

  toOpenAIMessage(): { role: string; content: string; name?: string } {
    return { role: this.role, content: this.content, name: this.name };
  }

  toGoogleMessage(): { author: string; content: string } {
    return { author: this.role, content: this.content };
  }
}
