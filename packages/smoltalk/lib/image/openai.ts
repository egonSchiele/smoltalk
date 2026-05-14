import OpenAI from "openai";
import { toFile } from "openai/uploads";
import {
  ImageInput,
  ImageConfig,
  ImageGenResult,
  GeneratedImage,
} from "../image.js";
import { Result, success, failure } from "../types/result.js";
import { getModel, isImageModel } from "../models.js";
import { normalizeImageRef, NormalizedImage } from "../util/imageRef.js";
import {
  COST_DECIMAL_PLACES,
  omitUndefined,
  round,
  tokenCost,
} from "../util/util.js";

export async function openaiImage(
  input: ImageInput,
  config: ImageConfig,
  apiKey: string,
): Promise<Result<ImageGenResult>> {
  try {
    const normalized = typeof input === "string" ? { prompt: input } : input;

    const hasImages = !!(normalized.images && normalized.images.length > 0);
    if (normalized.mask && !hasImages) {
      return failure(
        "A mask was provided without any input images. Masks are only valid for image edits — pass at least one entry in `images` alongside the mask.",
      );
    }

    const client = new OpenAI({ apiKey });
    const baseParams = buildBaseParams(config, normalized.prompt);

    const response = hasImages
      ? await callEdit(client, baseParams, normalized)
      : await (client.images.generate as any)(baseParams);

    const mimeType = mimeFromFormat(config.outputFormat) ?? "image/png";
    const images: GeneratedImage[] = (response.data ?? []).map((d: any) => ({
      data: new Uint8Array(Buffer.from(d.b64_json, "base64")),
      mimeType,
      revisedPrompt: d.revised_prompt,
    }));

    const tokenUsage = extractUsage(response);
    const costEstimate = tokenUsage
      ? calculateImageCost(config.model, tokenUsage)
      : calculatePerImageCost(config.model, images.length);

    return success({
      images,
      model: config.model,
      tokenUsage,
      costEstimate,
    });
  } catch (err) {
    return failure(
      err instanceof Error ? err.message : "OpenAI image request failed",
    );
  }
}

function buildBaseParams(
  config: ImageConfig,
  prompt: string,
): Record<string, unknown> {
  return omitUndefined({
    model: config.model,
    prompt,
    n: config.n,
    size: config.size,
    quality: config.quality,
    output_format: config.outputFormat,
    background: config.background,
    ...(config.metadata ?? {}),
  });
}

async function callEdit(
  client: OpenAI,
  baseParams: Record<string, unknown>,
  normalized: { prompt: string; images?: any[]; mask?: any },
): Promise<any> {
  const imageFiles = await Promise.all(
    (normalized.images ?? []).map(async (ref, i) => {
      const n = await normalizeImageRef(ref);
      return toFileFor(n, `image-${i}`);
    }),
  );
  const maskFile = normalized.mask
    ? await toFileFor(await normalizeImageRef(normalized.mask), "mask")
    : undefined;

  return (client.images.edit as any)(
    omitUndefined({
      ...baseParams,
      image: imageFiles.length === 1 ? imageFiles[0] : imageFiles,
      mask: maskFile,
    }),
  );
}

async function toFileFor(img: NormalizedImage, baseName: string) {
  return toFile(img.data, `${baseName}.${extFromMime(img.mimeType)}`, {
    type: img.mimeType,
  });
}

function extFromMime(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

function mimeFromFormat(fmt?: string): string | undefined {
  if (!fmt) return undefined;
  if (fmt === "jpeg") return "image/jpeg";
  if (fmt === "webp") return "image/webp";
  return "image/png";
}

function extractUsage(response: any) {
  const u = response?.usage;
  if (!u) return undefined;
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cachedInputTokens: u.input_tokens_details?.cached_tokens,
    inputImageTokens: u.input_tokens_details?.image_tokens,
    inputTextTokens: u.input_tokens_details?.text_tokens,
    totalTokens: u.total_tokens,
  };
}

type Usage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  inputImageTokens?: number;
  inputTextTokens?: number;
};

function calculateImageCost(modelName: string, usage: Usage) {
  const model = getModel(modelName);
  if (!model || !isImageModel(model)) return undefined;

  const totalIn = usage.inputTokens ?? 0;
  const cachedIn = usage.cachedInputTokens ?? 0;
  const imgOut = usage.outputTokens ?? 0;

  // Prefer the detailed breakdown if the API returned it; otherwise treat
  // all non-cached input tokens as text input.
  let textIn: number;
  let imageIn: number;
  if (
    usage.inputTextTokens !== undefined ||
    usage.inputImageTokens !== undefined
  ) {
    textIn = Math.max(0, (usage.inputTextTokens ?? 0) - cachedIn);
    imageIn = usage.inputImageTokens ?? 0;
  } else {
    textIn = Math.max(0, totalIn - cachedIn);
    imageIn = 0;
  }

  const textInputCost = tokenCost(textIn, model.inputTokenCost);
  const imageInputCost = tokenCost(imageIn, model.inputImageTokenCost);
  const cachedCost = tokenCost(cachedIn, model.cachedInputTokenCost);
  const outputCost = tokenCost(imgOut, model.outputImageTokenCost);
  const inputCost = round(textInputCost + imageInputCost, COST_DECIMAL_PLACES);
  const totalCost = round(
    inputCost + cachedCost + outputCost,
    COST_DECIMAL_PLACES,
  );
  return {
    inputCost,
    outputCost,
    cachedInputCost: cachedCost,
    totalCost,
    currency: "USD",
  };
}

function calculatePerImageCost(modelName: string, imageCount: number) {
  const model = getModel(modelName);
  if (!model || !isImageModel(model) || !model.costPerImage) return undefined;
  const totalCost = round(model.costPerImage * imageCount, COST_DECIMAL_PLACES);
  return { inputCost: 0, outputCost: totalCost, totalCost, currency: "USD" };
}
