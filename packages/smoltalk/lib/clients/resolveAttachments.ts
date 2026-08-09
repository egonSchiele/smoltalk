import { Message, UserMessage } from "../classes/message/index.js";
import { UserContentPart } from "../classes/message/contentParts.js";
import { normalizeBlob, ImageRef } from "../util/blobRef.js";
import { fileFamily } from "../util/attachments.js";
import { chatAudioFormat } from "../util/audioMime.js";
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

export async function resolveMessageAttachments(
  messages: Message[],
  options: { provider: string; maxBytes: number },
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
      if (part.type === "text") {
        resolvedParts.push(part);
        continue;
      }
      // Audio has no providerFile/URL passthrough: Chat input_audio requires
      // inline base64, so every audio source is normalized below.
      if (part.type === "audio") {
        try {
          const { data, mimeType } = await normalizeBlob(part.source, {
            allowedMimePrefixes: ["audio/"],
            maxBytes: options.maxBytes,
          });
          if (chatAudioFormat(mimeType) === null) {
            return failure(`Chat audio input supports only mp3/wav; got "${mimeType}".`);
          }
          const resolvedAudioPart: UserContentPart = {
            type: "audio",
            source: {
              kind: "base64",
              base64: Buffer.from(data).toString("base64"),
              mimeType,
            },
          };
          if (part.filename !== undefined) {
            resolvedAudioPart.filename = part.filename;
          }
          resolvedParts.push(resolvedAudioPart);
        } catch (err) {
          return failure(`Failed to load audio attachment: ${(err as Error).message}`);
        }
        continue;
      }
      // Provider file references are validated and passed through (no download/cap).
      // (`part` is narrowed to image/file here — audio already exited via `continue` above.)
      if (part.source.kind === "providerFile") {
        const family = fileFamily(options.provider);
        if (family === null || part.source.provider !== family) {
          return failure(
            `Attachment references a "${part.source.provider}" file, but this call targets provider ` +
              `"${options.provider}" (file family ${family ?? "none"}).`,
          );
        }
        if (part.type === "image" && options.provider === "openai") {
          return failure(
            "An image file reference requires the openai-responses provider (OpenAI Chat Completions has no image-by-file_id form).",
          );
        }
        resolvedParts.push(part);
        continue;
      }
      // Passthrough: keep a url ref when the target provider accepts a remote URL.
      if (part.source.kind === "url" && acceptsRemoteUrl(options.provider, part.type)) {
        resolvedParts.push(part);
        continue;
      }
      let allowed: string[];
      if (part.type === "image") {
        allowed = ["image/"];
      } else {
        allowed = ["application/pdf"];
      }
      try {
        const { data, mimeType } = await normalizeBlob(part.source, {
          allowedMimePrefixes: allowed,
          maxBytes: options.maxBytes,
        });
        const source: ImageRef = {
          kind: "base64",
          base64: Buffer.from(data).toString("base64"),
          mimeType,
        };
        if (part.type === "image") {
          resolvedParts.push({ type: "image", source });
        } else {
          resolvedParts.push({ type: "file", source, filename: part.filename });
        }
      } catch (err) {
        return failure(`Failed to load ${part.type} attachment: ${(err as Error).message}`);
      }
    }
    out.push(new UserMessage(resolvedParts, { name: msg.name, rawData: msg.rawData }));
  }
  return success(out);
}
