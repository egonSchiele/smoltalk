import { EgonLog } from "egonlog";
import { z } from "zod";
import { getLogger } from "../util/logger.js";
import { FunctionCall } from "@google/genai";
import { ResponseInputItem } from "openai/resources/responses/responses.js";

export const ToolCallJSONSchema = z.object({
  id: z.string().default(""),
  name: z.string(),
  arguments: z.record(z.string(), z.any()).default({}),
});

export type ToolCallJSON = z.infer<typeof ToolCallJSONSchema>;

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
        this.logger.debug(
          "Falling back to empty arguments object for ToolCall",
          { name, id, rawArgs: args },
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

  toJSON(): ToolCallJSON {
    return {
      id: this._id,
      name: this._name,
      arguments: this._arguments,
    };
  }

  static fromJSON(json: unknown): ToolCall {
    const result = ToolCallJSONSchema.safeParse(json);
    if (!result.success) {
      console.error("Failed to parse ToolCall");
      console.error(JSON.stringify(json, null, 2));
      console.error(z.prettifyError(result.error));
      throw new Error("Failed to parse ToolCall");
    }
    return new ToolCall(result.data.id, result.data.name, result.data.arguments);
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
