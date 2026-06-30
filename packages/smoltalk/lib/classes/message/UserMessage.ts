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
  mapContentParts,
} from "./contentParts.js";
import type { ImageRef } from "../../util/imageRef.js";
import { refToBase64, toDataUri, openAiImageUrl, anthropicSource } from "../../util/attachments.js";

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
    const parts = mapContentParts<any>(this._content, {
      onText: (p) => ({ type: "text", text: p.text }),
      onImage: (p) => ({ type: "image_url", image_url: { url: openAiImageUrl(p.source) } }),
      onFile: (p) => {
        const { base64, mimeType } = refToBase64(p.source);
        return { type: "file", file: { file_data: toDataUri(base64, mimeType), filename: p.filename } };
      },
    });
    return { role: this.role, content: parts as any, name: this.name } as ChatCompletionMessageParam;
  }

  toOpenAIResponseInputItem(): ResponseInputItem {
    if (typeof this._content === "string") {
      return { type: "message", role: "user", content: this._content } as ResponseInputItem;
    }
    const content = mapContentParts<any>(this._content, {
      onText: (p) => ({ type: "input_text", text: p.text }),
      onImage: (p) => ({ type: "input_image", image_url: openAiImageUrl(p.source), detail: "auto" }),
      onFile: (p) => {
        if (p.source.kind === "url") {
          return { type: "input_file", file_url: p.source.url };
        }
        const { base64, mimeType } = refToBase64(p.source);
        let filename = p.filename;
        if (filename === undefined) {
          filename = "attachment.pdf";
        }
        return { type: "input_file", file_data: toDataUri(base64, mimeType), filename };
      },
    });
    return { type: "message", role: "user", content } as ResponseInputItem;
  }

  toGoogleMessage(): Content {
    if (typeof this._content === "string") {
      return { role: this.role, parts: [{ text: this._content }] };
    }
    const parts = mapContentParts<any>(this._content, {
      onText: (p) => ({ text: p.text }),
      onImage: (p) => {
        const { base64, mimeType } = refToBase64(p.source);
        return { inlineData: { mimeType, data: base64 } };
      },
      onFile: (p) => {
        const { base64, mimeType } = refToBase64(p.source);
        return { inlineData: { mimeType, data: base64 } };
      },
    });
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
        images.push(refToBase64(part.source).base64);
        continue;
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
    const blocks = mapContentParts<any>(this._content, {
      onText: (p) => ({ type: "text", text: p.text }),
      onImage: (p) => ({ type: "image", source: anthropicSource(p.source) }),
      onFile: (p) => ({ type: "document", source: anthropicSource(p.source) }),
    });
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

function bytesRefToBase64(ref: ImageRef): ImageRef {
  if (ref.kind === "bytes") {
    return {
      kind: "base64",
      base64: Buffer.from(ref.data).toString("base64"),
      mimeType: ref.mimeType,
    };
  }
  return ref;
}

function serializeUserContentForJSON(content: UserContent): UserContent {
  if (typeof content === "string") {
    return content;
  }
  return mapContentParts<UserContentPart>(content, {
    onText: (p) => p,
    onImage: (p) => ({ type: "image", source: bytesRefToBase64(p.source) }),
    onFile: (p) => ({ type: "file", source: bytesRefToBase64(p.source), filename: p.filename }),
  });
}
