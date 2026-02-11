import { EgonLog } from "egonlog";
import { getLogger } from "../logger.js";
import { FunctionCall } from "@google/genai";
import { ResponseInputItem } from "openai/resources/responses/responses.js";

export type ToolCallOptions = {};

export class ToolCall {
  private _id: string;
  private _name: string;
  private _arguments: Record<string, any>;
  private logger: EgonLog;

  constructor(
    id: string,
    name: string,
    args: Record<string, any> | string,
    options: ToolCallOptions = {},
  ) {
    this._id = id;
    this._name = name;
    this.logger = getLogger();
    if (typeof args === "string") {
      try {
        this._arguments = JSON.parse(args);
      } catch (e) {
        this.logger.error(
          `Failed to parse arguments for ToolCall ${name} with id ${id}:`,
          e,
          args,
        );
        this._arguments = {};
      }
    } else {
      this._arguments = args;
    }
  }

  get id(): string {
    return this._id;
  }

  get name(): string {
    return this._name;
  }

  get arguments(): Record<string, any> {
    return this._arguments;
  }

  toJSON(): Record<string, any> {
    return {
      id: this._id,
      name: this._name,
      arguments: this._arguments,
    };
  }

  static fromJSON(json: any): ToolCall {
    return new ToolCall(json.id, json.name, json.arguments);
  }

  toOpenAI(): any {
    return {
      id: this._id,
      type: "function" as const,
      function: {
        name: this.name,
        arguments: JSON.stringify(this.arguments),
      },
    };
  }

  toGoogle(): { functionCall: FunctionCall } {
    return {
      functionCall: {
        name: this.name,
        args: this.arguments,
      },
    };
  }

  toOpenAIResponseInputItem(): ResponseInputItem {
    return {
      type: "function_call",
      call_id: this.id,
      name: this.name,
      arguments: JSON.stringify(this.arguments),
    } as ResponseInputItem;
  }
}
