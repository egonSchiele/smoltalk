import type { ImageRef } from "./imageRef.js";

/** Filename sent to providers that require one when a file part omits its own. */
export const DEFAULT_ATTACHMENT_FILENAME = "attachment.pdf";

/** A file part's filename, falling back to the shared default when unset. */
export function attachmentFilename(filename?: string): string {
  if (filename === undefined) {
    return DEFAULT_ATTACHMENT_FILENAME;
  }
  return filename;
}

/**
 * Extract base64 + MIME from an ImageRef that has already been resolved to
 * in-memory bytes. `path`/`url` refs must be resolved (via the BaseClient
 * normalize pass) before serialization — reaching here with one is a bug.
 */
export function refToBase64(ref: ImageRef): { base64: string; mimeType: string } {
  if (ref.kind === "base64") {
    return { base64: ref.base64, mimeType: ref.mimeType };
  }
  if (ref.kind === "bytes") {
    return { base64: Buffer.from(ref.data).toString("base64"), mimeType: ref.mimeType };
  }
  throw new Error(
    `Attachment ref must be resolved to base64 or bytes before serialization ` +
      `(got kind="${ref.kind}"). This is a smoltalk bug.`,
  );
}

export function toDataUri(base64: string, mimeType: string): string {
  return `data:${mimeType};base64,${base64}`;
}

/**
 * OpenAI-style image URL: a passthrough `url` ref stays a remote URL; anything
 * else becomes a base64 data URI.
 */
export function openAiImageUrl(ref: ImageRef): string {
  if (ref.kind === "url") {
    return ref.url;
  }
  const { base64, mimeType } = refToBase64(ref);
  return toDataUri(base64, mimeType);
}

/**
 * Anthropic image/document source: a passthrough `url` ref becomes a url source;
 * anything else becomes a base64 source.
 */
export function anthropicSource(
  ref: ImageRef,
): { type: "url"; url: string } | { type: "base64"; media_type: string; data: string } {
  if (ref.kind === "url") {
    return { type: "url", url: ref.url };
  }
  const { base64, mimeType } = refToBase64(ref);
  return { type: "base64", media_type: mimeType, data: base64 };
}
