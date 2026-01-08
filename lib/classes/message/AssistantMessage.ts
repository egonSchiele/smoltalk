import { BaseMessage, MessageClass } from "./BaseMessage.js";
import { TextPart } from "../../types.js";
import { ChatCompletionMessageParam } from "openai/resources";
import { Content } from "@google/genai";

export class AssistantMessage extends BaseMessage implements MessageClass {
  public _role = "assistant" as const;
  public _content: string | Array<TextPart> | null;
  public _name?: string;
  public _audio?: any | null;
  public _function_call?: any | null;
  public _refusal?: string | null;
  public _tool_calls?: Array<any>;
  public _rawData?: any;

  constructor(
    content: string | Array<TextPart> | null,
    options: {
      name?: string;
      audio?: any | null;
      function_call?: any | null;
      refusal?: string | null;
      tool_calls?: Array<any>;
      rawData?: any;
    } = {}
  ) {
    super();
    this._content = content;
    this._name = options.name;
    this._audio = options.audio;
    this._function_call = options.function_call;
    this._refusal = options.refusal;
    this._tool_calls = options.tool_calls;
    this._rawData = options.rawData;
  }

  get content(): string {
    if (this._content === null || this._content === undefined) {
      return "";
    }
    return typeof this._content === "string"
      ? this._content
      : JSON.stringify(this._content);
  }

  get role() {
    return this._role;
  }

  get name(): string | undefined {
    return this._name;
  }

  get audio(): any | null | undefined {
    return this._audio;
  }

  get function_call(): any | null | undefined {
    return this._function_call;
  }

  get refusal(): string | null | undefined {
    return this._refusal;
  }

  get tool_calls(): Array<any> | undefined {
    return this._tool_calls;
  }

  get rawData(): any {
    return this._rawData;
  }

  toOpenAIMessage(): ChatCompletionMessageParam {
    return { role: this.role, content: this.content, name: this.name };
  }

  toGoogleMessage(): Content {
    return { role: this.role, parts: [{ text: this.content }] };
  }
}
