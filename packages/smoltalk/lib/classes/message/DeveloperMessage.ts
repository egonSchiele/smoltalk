import { z } from "zod";
import {
  BaseMessage,
  MessageClass,
  MessageMetadata,
  MessageMetadataSchema,
} from "./BaseMessage.js";
import { TextPart, TextPartSchema } from "../../types.js";
import { ChatCompletionMessageParam } from "openai/resources";
import { Content } from "@google/genai";
import { Message } from "ollama";
import type { ResponseInputItem } from "openai/resources/responses/responses.js";
import { getLogger } from "../../util/logger.js";

export const DeveloperMessageJSONSchema = z.object({
  role: z.literal("developer"),
  content: z.union([z.string(), z.array(TextPartSchema)]),
  name: z.string().optional(),
  rawData: z.any().optional(),
  metadata: MessageMetadataSchema.optional(),
});

export type DeveloperMessageJSON = z.infer<typeof DeveloperMessageJSONSchema>;

export class DeveloperMessage extends BaseMessage implements MessageClass {
  public _role = "developer" as const;
  public _content: string | Array<TextPart>;
  public _name?: string;
  public _rawData?: any;
  public _metadata?: MessageMetadata;

  constructor(
    content: string | Array<TextPart>,
    options: { name?: string; rawData?: any; metadata?: MessageMetadata } = {},
  ) {
    super();
    this._content = content;
    this._name = options.name;
    this._rawData = options.rawData;
    this._metadata = options.metadata;
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

  get name(): string | undefined {
    return this._name;
  }

  get rawData(): any {
    return this._rawData;
  }

  /** Opaque data the caller keeps on the message. Round-tripped through
   *  toJSON/fromJSON; never read by smoltalk, never sent to a provider. */
  get metadata(): MessageMetadata | undefined {
    return this._metadata;
  }

  set metadata(value: MessageMetadata | undefined) {
    this._metadata = value;
  }

  toJSON(): DeveloperMessageJSON {
    return {
      role: this.role,
      content: this._content,
      name: this.name,
      rawData: this._rawData,
      metadata: this._metadata,
    };
  }

  static fromJSON(json: unknown): DeveloperMessage {
    const result = DeveloperMessageJSONSchema.safeParse(json);
    if (!result.success) {
      const logger = getLogger();
      logger.error("Failed to parse DeveloperMessage:", z.prettifyError(result.error));
      // Raw payload can contain developer-message content — only at debug level.
      logger.debug("DeveloperMessage payload that failed to parse:", JSON.stringify(json, null, 2));
      throw new Error("Failed to parse DeveloperMessage");
    }
    return new DeveloperMessage(result.data.content, {
      name: result.data.name,
      rawData: result.data.rawData,
      metadata: result.data.metadata,
    });
  }

  toOpenAIMessage(): ChatCompletionMessageParam {
    return { role: this.role, content: this.content, name: this.name };
  }

  toOpenAIResponseInputItem(): ResponseInputItem {
    return {
      type: "message",
      role: "developer",
      content: this.content,
    } as ResponseInputItem;
  }

  toGoogleMessage(): Content {
    return { role: this.role, parts: [{ text: this.content }] };
  }

  toOllamaMessage(): Message {
    return { role: this.role, content: this.content };
  }

  // Developer messages are treated like system messages in Anthropic's API.
  // Returns null to signal they should be collected into the `system` param.
  toAnthropicMessage(): null {
    return null;
  }
}
