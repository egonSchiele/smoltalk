import { z } from "zod";
import { BaseMessage, MessageClass } from "./BaseMessage.js";
import { TextPart, TextPartSchema } from "../../types.js";
import { ChatCompletionMessageParam } from "openai/resources";
import { Content, FunctionResponse } from "@google/genai";
import { Message } from "ollama";
import type { ResponseInputItem } from "openai/resources/responses/responses.js";
import { getLogger } from "../../util/logger.js";

export const ToolMessageJSONSchema = z.object({
  role: z.literal("tool"),
  //content: z.union([z.string(), z.array(TextPartSchema)]),
  content: z.any(),
  name: z.string(),
  tool_call_id: z.string().default(""),
  rawData: z.any().optional(),
});

export type ToolMessageJSON = {
  role: "tool";
  content: any;
  name: string;
  tool_call_id: string;
  rawData?: any;
};

export class ToolMessage extends BaseMessage implements MessageClass {
  public _role = "tool" as const;
  public _content: string | Array<TextPart>;
  public _tool_call_id: string;
  public _rawData?: any;
  public _name: string;

  constructor(
    content: string | Array<TextPart>,
    options: { tool_call_id: string; rawData?: any; name: string },
  ) {
    super();
    this._content = content;
    this._tool_call_id = options.tool_call_id;
    this._rawData = options.rawData;
    this._name = options.name;
  }

  get content(): string {
    return this.contentToString(this._content);
  }

  set content(value: string) {
    this._content = value;
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

  toJSON(): ToolMessageJSON {
    return {
      role: this.role,
      content: this._content,
      name: this.name,
      tool_call_id: this.tool_call_id,
    };
  }

  static fromJSON(json: unknown): ToolMessage {
    const result = ToolMessageJSONSchema.safeParse(json);

    if (!result.success) {
      const logger = getLogger();
      logger.error("Failed to parse ToolMessage:", z.prettifyError(result.error));
      // Raw payload can contain tool results (file paths, secrets) — only at debug level.
      logger.debug("ToolMessage payload that failed to parse:", JSON.stringify(json, null, 2));
      throw new Error("Failed to parse ToolMessage");
    }
    const TextPartArraySchema = z.array(TextPartSchema);

    const textPartArrayResult = TextPartArraySchema.safeParse(
      result.data.content,
    );
    if (textPartArrayResult.success) {
      result.data.content = textPartArrayResult.data;
    } else if (typeof result.data.content === "string") {
      // do nothing, it's already a string
    } else {
      getLogger().debug(
        "ToolMessage content is neither a string nor an array of TextParts. Converting to string using JSON.stringify.",
      );
      result.data.content = JSON.stringify(result.data.content);
    }

    return new ToolMessage(result.data.content, {
      tool_call_id: result.data.tool_call_id,
      name: result.data.name,
      rawData: result.data.rawData,
    });
  }

  toOpenAIMessage(): ChatCompletionMessageParam {
    return {
      role: this.role,
      content: this.content,
      tool_call_id: this.tool_call_id,
    };
  }

  toOpenAIResponseInputItem(): ResponseInputItem {
    return {
      type: "function_call_output",
      call_id: this.tool_call_id,
      output: this.content,
    } as ResponseInputItem;
  }

  toGoogleMessage(): Content {
    const functionResponse: FunctionResponse = {
      name: this.name,
      response: {
        result: this.content,
      },
    };
    // Echo the id so Gemini 3.5+ pairs this response to its call by id,
    // order-free. Only when non-empty: Gemini 3 never issues ids, and an empty
    // string is noise it rejects or ignores.
    if (this.tool_call_id !== "") {
      functionResponse.id = this.tool_call_id;
    }

    return {
      role: "user",
      parts: [{ functionResponse }],
    };
  }

  toOllamaMessage(): Message {
    return {
      role: this.role,
      tool_name: this.name,
      content: this.content,
    };
  }

  // In Anthropic's API, tool results are user-role messages containing tool_result blocks.
  toAnthropicMessage(): {
    role: "user";
    content: Array<{
      type: "tool_result";
      tool_use_id: string;
      content: string;
    }>;
  } {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: this.tool_call_id,
          content: this.content,
        },
      ],
    };
  }
}
