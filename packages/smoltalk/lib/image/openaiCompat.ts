import OpenAI from "openai";
import {
  ImageInput,
  ImageConfig,
  ImageGenResult,
  GeneratedImage,
} from "../image.js";
import { Result, success, failure } from "../types/result.js";
import { omitUndefined } from "../util/util.js";

/**
 * Generic OpenAI-compatible image generation. Used by litellm/openai-compat —
 * any backend that speaks the OpenAI `/images/generations` shape. Image edits
 * are not supported here (the multipart upload shape varies between backends);
 * pass a plain prompt only.
 */
export async function openaiCompatImage(
  input: ImageInput,
  config: ImageConfig,
  apiKey: string,
  baseURL: string,
): Promise<Result<ImageGenResult>> {
  try {
    const normalized = typeof input === "string" ? { prompt: input } : input;

    const hasImages = !!(normalized.images && normalized.images.length > 0);
    if (hasImages) {
      return failure(
        "openai-compat: image edits (passing `images`) are not supported on this generic adapter. Use the `openai` provider for OpenAI image edits.",
      );
    }
    if (normalized.mask) {
      return failure(
        "openai-compat: image masks are not supported on this generic adapter.",
      );
    }

    const client = new OpenAI({ apiKey, baseURL });
    const params = omitUndefined({
      model: config.model,
      prompt: normalized.prompt,
      n: config.n,
      size: config.size,
      quality: config.quality,
      output_format: config.outputFormat,
      background: config.background,
      ...(config.metadata ?? {}),
    });

    const response = await (client.images.generate as any)(params);
    const mimeType = mimeFromFormat(config.outputFormat) ?? "image/png";
    const images: GeneratedImage[] = (response.data ?? []).map((d: any) => ({
      data: new Uint8Array(Buffer.from(d.b64_json, "base64")),
      mimeType,
      revisedPrompt: d.revised_prompt,
    }));

    return success({
      images,
      model: config.model,
    });
  } catch (err) {
    return failure(
      err instanceof Error
        ? err.message
        : "OpenAI-compatible image request failed",
    );
  }
}

function mimeFromFormat(format?: string): string | undefined {
  switch (format) {
    case "png":
      return "image/png";
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    default:
      return undefined;
  }
}
