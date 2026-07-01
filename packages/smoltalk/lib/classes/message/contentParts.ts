import { z } from "zod";
import type { ImageRef } from "../../util/imageRef.js";

export type TextPart = {
  type: "text";
  text: string;
};

export type ImagePart = {
  type: "image";
  source: AttachmentSource;
};

export type FilePart = {
  type: "file";
  source: AttachmentSource;
  filename?: string;
};

export type UserContentPart = TextPart | ImagePart | FilePart;

/** Normalized user-message content: a plain string or an array of typed parts. */
export type UserContent = string | UserContentPart[];

/** What callers may pass: a bare string element is sugar for a text part. */
export type UserContentInput = string | Array<string | UserContentPart>;

export const TextPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

export const ImageRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bytes"), data: z.instanceof(Uint8Array), mimeType: z.string() }),
  z.object({ kind: z.literal("base64"), base64: z.string(), mimeType: z.string() }),
  z.object({ kind: z.literal("path"), path: z.string(), mimeType: z.string().optional() }),
  z.object({
    kind: z.literal("url"),
    url: z.string(),
    mimeType: z.string().optional(),
    timeoutMs: z.number().optional(),
  }),
]);

export type ProviderFileRef = {
  kind: "providerFile";
  provider: string;
  id: string;
  uri?: string;
  mimeType?: string;
  expiresAt?: number;
};

export const ProviderFileRefSchema = z.object({
  kind: z.literal("providerFile"),
  provider: z.string(),
  id: z.string(),
  uri: z.string().optional(),
  mimeType: z.string().optional(),
  expiresAt: z.number().optional(),
});

export type AttachmentSource = ImageRef | ProviderFileRef;

// Compose from ImageRefSchema so future arms don't need mirroring here.
export const AttachmentSourceSchema = z.discriminatedUnion("kind", [
  ...ImageRefSchema.options,
  ProviderFileRefSchema,
]);

export type AttachmentSourceVisitor<T> = {
  onInline: (src: ImageRef) => T;
  onProviderFile: (ref: ProviderFileRef) => T;
};

export function mapAttachmentSource<T>(
  source: AttachmentSource,
  v: AttachmentSourceVisitor<T>,
): T {
  if (source.kind === "providerFile") {
    return v.onProviderFile(source);
  }
  return v.onInline(source);
}

export const ImagePartSchema = z.object({
  type: z.literal("image"),
  source: AttachmentSourceSchema,
});

export const FilePartSchema = z.object({
  type: z.literal("file"),
  source: AttachmentSourceSchema,
  filename: z.string().optional(),
});

export const UserContentPartSchema = z.discriminatedUnion("type", [
  TextPartSchema,
  ImagePartSchema,
  FilePartSchema,
]);

export const UserContentSchema = z.union([z.string(), z.array(UserContentPartSchema)]);

/**
 * Visitor over user content. Encapsulates the string-vs-array walk so consumers
 * (serializers, JSON) stay declarative — "what to emit per part", not "how to loop".
 */
export type ContentPartVisitor<T> = {
  onText: (part: TextPart) => T;
  onImage: (part: ImagePart) => T;
  onFile: (part: FilePart) => T;
};

export function mapContentParts<T>(
  content: UserContent,
  visitor: ContentPartVisitor<T>,
): T[] {
  if (typeof content === "string") {
    return [visitor.onText({ type: "text", text: content })];
  }
  const out: T[] = [];
  for (const part of content) {
    if (part.type === "text") {
      out.push(visitor.onText(part));
    } else if (part.type === "image") {
      out.push(visitor.onImage(part));
    } else {
      out.push(visitor.onFile(part));
    }
  }
  return out;
}
