import { z } from "zod";
import type { ImageRef, BlobRef } from "../../util/imageRef.js";

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

export type AudioPart = {
  type: "audio";
  source: BlobRef;
  filename?: string;
};

export type UserContentPart = TextPart | ImagePart | FilePart | AudioPart;

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

export const ImagePartSchema = z.object({
  type: z.literal("image"),
  source: AttachmentSourceSchema,
});

export const FilePartSchema = z.object({
  type: z.literal("file"),
  source: AttachmentSourceSchema,
  filename: z.string().optional(),
});

export const AudioPartSchema = z.object({
  type: z.literal("audio"),
  source: z.discriminatedUnion("kind", [...ImageRefSchema.options]),
  filename: z.string().optional(),
});

export const UserContentPartSchema = z.discriminatedUnion("type", [
  TextPartSchema,
  ImagePartSchema,
  FilePartSchema,
  AudioPartSchema,
]);

export const UserContentSchema = z.union([z.string(), z.array(UserContentPartSchema)]);
