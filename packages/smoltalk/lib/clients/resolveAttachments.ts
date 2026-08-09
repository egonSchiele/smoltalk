import { Message, UserMessage } from "../classes/message/index.js";
import {
  AudioPart,
  FilePart,
  ImagePart,
  UserContentPart,
} from "../classes/message/contentParts.js";
import { normalizeBlob, BlobRef } from "../util/blobRef.js";
import { fileFamily } from "../util/attachments.js";
import { audioFormatForMime } from "../util/mime.js";
import { Result, success, failure } from "../types.js";

export const DEFAULT_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const URL_IMAGE_PROVIDERS = new Set([
  "openai",
  "openai-responses",
  "openai-compat",
  "openrouter",
  "deepinfra",
  "litellm",
  "anthropic",
]);
const URL_PDF_PROVIDERS = new Set(["openai-responses", "anthropic"]);

type ResolveOptions = {
  provider: string;
  maxBytes: number;
  /** Audio containers (by primary extension) the target client accepts inline. */
  audioFormats: readonly string[];
};

/** Whether any user message carries an image/file attachment part. */
export function messagesHaveAttachments(messages: Message[]): boolean {
  for (const msg of messages) {
    if (!(msg instanceof UserMessage)) {
      continue;
    }
    const parts = msg.getContentParts();
    if (parts === null) {
      continue;
    }
    for (const part of parts) {
      if (part.type === "image" || part.type === "file" || part.type === "audio") {
        return true;
      }
    }
  }
  return false;
}

/** Whether `provider` accepts a remote URL directly for this part type. */
export function acceptsRemoteUrl(provider: string, partType: "image" | "file"): boolean {
  if (partType === "image") {
    return URL_IMAGE_PROVIDERS.has(provider);
  }
  return URL_PDF_PROVIDERS.has(provider);
}

/** Load a ref to inline base64, gated to `allowed` MIME prefixes. Throws on failure. */
async function toBase64Source(
  source: BlobRef,
  allowed: string[],
  maxBytes: number,
): Promise<{ kind: "base64"; base64: string; mimeType: string }> {
  const { data, mimeType } = await normalizeBlob(source, {
    allowedMimePrefixes: allowed,
    maxBytes,
  });
  return { kind: "base64", base64: Buffer.from(data).toString("base64"), mimeType };
}

/** Error message when a providerFile ref targets the wrong provider family, else null. */
function providerFileError(fileProvider: string, targetProvider: string): string | null {
  const family = fileFamily(targetProvider);
  if (family === null || fileProvider !== family) {
    return (
      `Attachment references a "${fileProvider}" file, but this call targets provider ` +
      `"${targetProvider}" (file family ${family ?? "none"}).`
    );
  }
  return null;
}

// Audio has no providerFile/URL passthrough: Chat input_audio requires
// inline base64, so every audio source is normalized here.
async function resolveAudioPart(
  part: AudioPart,
  options: ResolveOptions,
): Promise<Result<UserContentPart>> {
  try {
    const source = await toBase64Source(part.source, ["audio/"], options.maxBytes);
    const audioFormat = audioFormatForMime(source.mimeType);
    if (audioFormat === null || !options.audioFormats.includes(audioFormat.extension)) {
      return failure(
        `Audio input for provider "${options.provider}" supports only ` +
          `${options.audioFormats.join(", ")}; got "${source.mimeType}".`,
      );
    }
    const resolved: UserContentPart = { type: "audio", source };
    if (part.filename !== undefined) {
      resolved.filename = part.filename;
    }
    return success(resolved);
  } catch (err) {
    return failure(`Failed to load audio attachment: ${(err as Error).message}`);
  }
}

async function resolveImagePart(
  part: ImagePart,
  options: ResolveOptions,
): Promise<Result<UserContentPart>> {
  // Provider file references are validated and passed through (no download/cap).
  if (part.source.kind === "providerFile") {
    const mismatch = providerFileError(part.source.provider, options.provider);
    if (mismatch !== null) {
      return failure(mismatch);
    }
    if (options.provider === "openai") {
      return failure(
        "An image file reference requires the openai-responses provider (OpenAI Chat Completions has no image-by-file_id form).",
      );
    }
    return success(part);
  }
  // Passthrough: keep a url ref when the target provider accepts a remote URL.
  if (part.source.kind === "url" && acceptsRemoteUrl(options.provider, "image")) {
    return success(part);
  }
  try {
    const source = await toBase64Source(part.source, ["image/"], options.maxBytes);
    return success({ type: "image", source });
  } catch (err) {
    return failure(`Failed to load image attachment: ${(err as Error).message}`);
  }
}

async function resolveFilePart(
  part: FilePart,
  options: ResolveOptions,
): Promise<Result<UserContentPart>> {
  // Provider file references are validated and passed through (no download/cap).
  if (part.source.kind === "providerFile") {
    const mismatch = providerFileError(part.source.provider, options.provider);
    if (mismatch !== null) {
      return failure(mismatch);
    }
    return success(part);
  }
  // Passthrough: keep a url ref when the target provider accepts a remote URL.
  if (part.source.kind === "url" && acceptsRemoteUrl(options.provider, "file")) {
    return success(part);
  }
  try {
    const source = await toBase64Source(part.source, ["application/pdf"], options.maxBytes);
    return success({ type: "file", source, filename: part.filename });
  } catch (err) {
    return failure(`Failed to load file attachment: ${(err as Error).message}`);
  }
}

async function resolveUserPart(
  part: UserContentPart,
  options: ResolveOptions,
): Promise<Result<UserContentPart>> {
  if (part.type === "text") {
    return success(part);
  }
  if (part.type === "audio") {
    return resolveAudioPart(part, options);
  }
  if (part.type === "image") {
    return resolveImagePart(part, options);
  }
  return resolveFilePart(part, options);
}

export async function resolveMessageAttachments(
  messages: Message[],
  options: ResolveOptions,
): Promise<Result<Message[]>> {
  const out: Message[] = [];
  for (const msg of messages) {
    if (!(msg instanceof UserMessage)) {
      out.push(msg);
      continue;
    }
    const parts = msg.getContentParts();
    if (parts === null) {
      out.push(msg);
      continue;
    }
    const resolvedParts: UserContentPart[] = [];
    for (const part of parts) {
      const resolved = await resolveUserPart(part, options);
      if (!resolved.success) {
        return resolved;
      }
      resolvedParts.push(resolved.value);
    }
    out.push(new UserMessage(resolvedParts, { name: msg.name, rawData: msg.rawData }));
  }
  return success(out);
}
