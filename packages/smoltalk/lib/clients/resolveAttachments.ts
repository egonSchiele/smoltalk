import { Message, UserMessage } from "../classes/message/index.js";
import { UserContentPart } from "../classes/message/contentParts.js";
import { normalizeImageRef, ImageRef } from "../util/imageRef.js";
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
      if (part.type === "image" || part.type === "file") {
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
        const { data, mimeType } = await normalizeImageRef(part.source, {
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
