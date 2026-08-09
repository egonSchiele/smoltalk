import { z } from "zod";
import { BaseMessage, MessageClass } from "./BaseMessage.js";
import { ChatCompletionMessageParam } from "openai/resources";
import { Content } from "@google/genai";
import { Message } from "ollama";
import type { ResponseInputItem } from "openai/resources/responses/responses.js";
import { getLogger } from "../../util/logger.js";
import {
  UserContent,
  UserContentInput,
  UserContentPart,
  UserContentSchema,
} from "./contentParts.js";
import { refToBase64 } from "../../util/attachments.js";
import { renderParts } from "./renderers/PartRenderer.js";
import { OpenAIChatRenderer } from "./renderers/OpenAIChatRenderer.js";
import { OpenAIResponsesRenderer } from "./renderers/OpenAIResponsesRenderer.js";
import { GoogleRenderer } from "./renderers/GoogleRenderer.js";
import { AnthropicRenderer } from "./renderers/AnthropicRenderer.js";
import { JSONRenderer } from "./renderers/JSONRenderer.js";

export const UserMessageJSONSchema = z.object({
  role: z.literal("user"),
  content: UserContentSchema,
  name: z.string().optional(),
  rawData: z.any().optional(),
});

export type UserMessageJSON = z.infer<typeof UserMessageJSONSchema>;

export class UserMessage extends BaseMessage implements MessageClass {
  public _role = "user" as const;
  public _content: UserContent;
  public _name?: string;
  public _rawData?: any;

  constructor(content: UserContentInput, options: { name?: string; rawData?: any } = {}) {
    super();
    this._content = normalizeUserContent(content);
    this._name = options.name;
    this._rawData = options.rawData;
  }

  get content(): string {
    return userContentToText(this._content);
  }

  set content(value: UserContentInput) {
    this._content = normalizeUserContent(value);
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

  /** The content parts array, or null when content is a plain string. */
  getContentParts(): UserContentPart[] | null {
    if (typeof this._content === "string") {
      return null;
    }
    return this._content;
  }

  toJSON(): UserMessageJSON {
    return {
      role: this.role,
      content: serializeUserContentForJSON(this._content) as UserMessageJSON["content"],
      name: this.name,
    };
  }

  static fromJSON(json: unknown): UserMessage {
    const result = UserMessageJSONSchema.safeParse(json);
    if (!result.success) {
      const logger = getLogger();
      logger.error("Failed to parse UserMessage:", z.prettifyError(result.error));
      // Raw payload can contain user prompts / PII — only at debug level.
      logger.debug("UserMessage payload that failed to parse:", JSON.stringify(json, null, 2));
      throw new Error("Failed to parse UserMessage");
    }
    return new UserMessage(result.data.content, {
      name: result.data.name,
      rawData: result.data.rawData,
    });
  }

  toOpenAIMessage(): ChatCompletionMessageParam {
    if (typeof this._content === "string") {
      return { role: this.role, content: this._content, name: this.name };
    }
    const parts = renderParts<any>(this._content, new OpenAIChatRenderer());
    return { role: this.role, content: parts as any, name: this.name } as ChatCompletionMessageParam;
  }

  toOpenAIResponseInputItem(): ResponseInputItem {
    if (typeof this._content === "string") {
      return { type: "message", role: "user", content: this._content } as ResponseInputItem;
    }
    const content = renderParts<any>(this._content, new OpenAIResponsesRenderer());
    return { type: "message", role: "user", content } as ResponseInputItem;
  }

  toGoogleMessage(): Content {
    if (typeof this._content === "string") {
      return { role: this.role, parts: [{ text: this._content }] };
    }
    const parts = renderParts<any>(this._content, new GoogleRenderer());
    return { role: this.role, parts };
  }

  toOllamaMessage(): Message {
    if (typeof this._content === "string") {
      return { role: this.role, content: this._content };
    }
    const texts: string[] = [];
    const images: string[] = [];
    for (const part of this._content) {
      if (part.type === "text") {
        texts.push(part.text);
        continue;
      }
      if (part.type === "image") {
        if (part.source.kind === "providerFile") {
          throw new Error("Ollama does not support provider file references.");
        }
        images.push(refToBase64(part.source).base64);
        continue;
      }
      if (part.type === "audio") {
        throw new Error("Ollama does not support audio input.");
      }
      if (part.source.kind === "providerFile") {
        throw new Error("Ollama does not support provider file references.");
      }
      getLogger().warn("Ollama does not support file attachments; dropping a file part.");
    }
    const message: Message = { role: this.role, content: texts.join("\n") };
    if (images.length > 0) {
      message.images = images;
    }
    return message;
  }

  toAnthropicMessage(): { role: "user"; content: string | any[] } {
    if (typeof this._content === "string") {
      return { role: "user", content: this._content };
    }
    const blocks = renderParts<any>(this._content, new AnthropicRenderer());
    return { role: "user", content: blocks };
  }
}

function normalizeUserContent(content: UserContentInput): UserContent {
  if (typeof content === "string") {
    return content;
  }
  const parts: UserContentPart[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      parts.push({ type: "text", text: part });
    } else {
      parts.push(part);
    }
  }
  return parts;
}

function userContentToText(content: UserContent): string {
  if (typeof content === "string") {
    return content;
  }
  const texts: string[] = [];
  for (const part of content) {
    if (part.type === "text") {
      texts.push(part.text);
    }
  }
  return texts.join("\n");
}

function serializeUserContentForJSON(content: UserContent): UserContent {
  if (typeof content === "string") {
    return content;
  }
  return renderParts<UserContentPart>(content, new JSONRenderer());
}
