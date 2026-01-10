import { BaseMessage, MessageClass } from "./BaseMessage.js";
import { TextPart } from "../../types.js";
import { ChatCompletionMessageParam } from "openai/resources";
import { Content } from "@google/genai";

export class ToolMessage extends BaseMessage implements MessageClass {
  public _role = "tool" as const;
  public _content: string | Array<TextPart>;
  public _tool_call_id: string;
  public _rawData?: any;
  public _name: string;

  constructor(
    content: string | Array<TextPart>,
    options: { tool_call_id: string; rawData?: any; name: string }
  ) {
    super();
    this._content = content;
    this._tool_call_id = options.tool_call_id;
    this._rawData = options.rawData;
    this._name = options.name;
  }

  get content(): string {
    return typeof this._content === "string"
      ? this._content
      : JSON.stringify(this._content);
  }

  get role() {
    return this._role;
  }

  get name(): string {
    return this._name;
  }

  get tool_call_id(): string {
    return this._tool_call_id;
  }

  get rawData(): any {
    return this._rawData;
  }

  toJSON() {
    return {
      role: this.role,
      content: this._content,
      name: this.name,
      tool_call_id: this.tool_call_id,
    };
  }

  toOpenAIMessage(): ChatCompletionMessageParam {
    return {
      role: this.role,
      content: this.content,
      tool_call_id: this.tool_call_id,
    };
  }

  toGoogleMessage(): Content {
    return {
      role: "user", parts: [{
        functionResponse: {
          name: this.name,
          response: {
            result: this.content
          }
        }
      }]
    };
  }
}
