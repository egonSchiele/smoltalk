import { BaseMessage, MessageClass } from "./BaseMessage.js";

export class UserMessage extends BaseMessage implements MessageClass {
  constructor(
    public _content: string,
    public _role: "user",
    public _name?: string,
    public _rawData?: any
  ) {
    super();
  }

  get content(): string {
    return this._content;
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
