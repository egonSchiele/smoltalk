import { EgonLog } from "../util/logger.js";
import { z } from "zod";
import { getLogger } from "../util/logger.js";
import { FunctionCall } from "@google/genai";
import { ResponseInputItem } from "openai/resources/responses/responses.js";

export const ToolCallJSONSchema = z.object({
  id: z.string().default(""),
  name: z.string(),
  arguments: z.record(z.string(), z.any()).default({}),
  // Google Gemini 3 attaches an encrypted thought signature to the same part as
  // the function call; it must be echoed back verbatim during tool use.
  thoughtSignature: z.string().optional(),
});

export type ToolCallJSON = z.infer<typeof ToolCallJSONSchema>;

export type ToolCallOptions = {
  thoughtSignature?: string;
};

export class ToolCall {
  private _id: string;
  private _name: string;
  private _arguments: Record<string, any>;
  private _thoughtSignature?: string;
  private logger: EgonLog;

  constructor(
    id: string,
    name: string,
    args: Record<string, any> | string,
    options: ToolCallOptions = {},
  ) {
    this._id = id;
    this._name = name;
    this._thoughtSignature = options.thoughtSignature;
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

  get thoughtSignature(): string | undefined {
    return this._thoughtSignature;
  }

  toJSON(): ToolCallJSON {
    return {
      id: this._id,
      name: this._name,
      arguments: this._arguments,
      ...(this._thoughtSignature !== undefined && {
        thoughtSignature: this._thoughtSignature,
      }),
    };
  }

  static fromJSON(json: unknown): ToolCall {
    const result = ToolCallJSONSchema.safeParse(json);
    if (!result.success) {
      const logger = getLogger();
      logger.error("Failed to parse ToolCall:", z.prettifyError(result.error));
      // Raw payload can contain tool-call arguments (often secrets) — only at debug level.
      logger.debug("ToolCall payload that failed to parse:", JSON.stringify(json, null, 2));
      throw new Error("Failed to parse ToolCall");
    }
    return new ToolCall(result.data.id, result.data.name, result.data.arguments, {
      thoughtSignature: result.data.thoughtSignature,
    });
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

  toGoogle(): { functionCall: FunctionCall; thoughtSignature?: string } {
    const functionCall: FunctionCall = {
      name: this.name,
      args: this.arguments,
    };
    // Echo the id when we have one: the Gemini API pairs a functionResponse
    // back to its functionCall by id when present. Omit it when empty — current
    // Gemini 3 preview models issue no ids, and an empty id is not a valid key.
    if (this._id !== "") {
      functionCall.id = this._id;
    }

    const result: { functionCall: FunctionCall; thoughtSignature?: string } = {
      functionCall,
    };
    // Gemini 3 requires the original thought signature echoed back on the
    // function-call part; omitting it fails validation during tool use.
    if (this._thoughtSignature !== undefined) {
      result.thoughtSignature = this._thoughtSignature;
    }
    return result;
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
