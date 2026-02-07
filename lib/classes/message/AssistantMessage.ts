import { BaseMessage, MessageClass } from "./BaseMessage.js";
import { TextPart } from "../../types.js";
import { ChatCompletionMessageParam } from "openai/resources";
import { Content, Part } from "@google/genai";
import { ToolCall } from "../ToolCall.js";
import { Message } from "ollama";

export class AssistantMessage extends BaseMessage implements MessageClass {
  public _role = "assistant" as const;
  public _content: string | Array<TextPart> | null;
  public _name?: string;
  public _audio?: any | null;
  public _refusal?: string | null;
  public _toolCalls?: ToolCall[];
  public _rawData?: any;

  constructor(
    content: string | Array<TextPart> | null,
    options: {
      name?: string;
      audio?: any | null;
      refusal?: string | null;
      toolCalls?: ToolCall[];
      rawData?: any;
    } = {},
  ) {
    super();
    this._content = content;
    this._name = options.name;
    this._audio = options.audio;
    this._refusal = options.refusal;
    this._toolCalls = options.toolCalls;
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

  get refusal(): string | null | undefined {
    return this._refusal;
  }

  get toolCalls(): ToolCall[] | undefined {
    return this._toolCalls;
  }

  get rawData(): any {
    return this._rawData;
  }

  toJSON() {
    return {
      role: this.role,
      content: this._content,
      name: this.name,
      audio: this.audio,
      refusal: this.refusal,
      toolCalls: this.toolCalls?.map((tc) => tc.toJSON()),
    };
  }

  static fromJSON(json: any): AssistantMessage {
    return new AssistantMessage(json.content, {
      name: json.name,
      audio: json.audio,
      refusal: json.refusal,
      toolCalls: json.toolCalls
        ? json.toolCalls.map((tcJson: any) => ToolCall.fromJSON(tcJson))
        : undefined,
      rawData: json.rawData,
    });
  }

  toOpenAIMessage(): ChatCompletionMessageParam {
    return {
      role: this.role,
      content: this.content,
      name: this.name,
      tool_calls: this.toolCalls?.map((tc) => tc.toOpenAI()),
    };
  }

  toGoogleMessage(): Content {
    const parts: Part[] = [];
    if (this.content) {
      parts.push({ text: this.content });
    }
    if (this.toolCalls) {
      for (const tc of this.toolCalls) {
        parts.push(tc.toGoogle());
      }
    }
    return { role: "model", parts };
  }

  toOllamaMessage(): Message {
    return {
      role: this.role,
      content: this.content,
      tool_calls: this.toolCalls?.map((tc) => tc.toOpenAI()),
    };
  }
}
