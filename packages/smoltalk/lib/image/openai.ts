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
import { normalizeImageRef } from "../util/imageRef.js";
import { round } from "../util/util.js";

export async function openaiImage(
  input: ImageInput,
  config: ImageConfig,
  apiKey: string,
): Promise<Result<ImageGenResult>> {
  try {
    const normalized = typeof input === "string" ? { prompt: input } : input;
    const client = new OpenAI({ apiKey });

    const baseParams: Record<string, unknown> = {
      model: config.model,
      prompt: normalized.prompt,
      ...(config.n !== undefined ? { n: config.n } : {}),
      ...(config.size !== undefined ? { size: config.size } : {}),
      ...(config.quality !== undefined ? { quality: config.quality } : {}),
      ...(config.outputFormat !== undefined
        ? { output_format: config.outputFormat }
        : {}),
      ...(config.background !== undefined
        ? { background: config.background }
        : {}),
      ...(config.metadata ?? {}),
    };

    const hasImages = normalized.images && normalized.images.length > 0;
    let response: any;

    if (hasImages) {
      const imageFiles = await Promise.all(
        (normalized.images ?? []).map(async (ref, i) => {
          const n = await normalizeImageRef(ref);
          return toFile(n.data, `image-${i}.${extFromMime(n.mimeType)}`, {
            type: n.mimeType,
          });
        }),
      );
      const maskFile = normalized.mask
        ? await (async () => {
            const m = await normalizeImageRef(normalized.mask!);
            return toFile(m.data, `mask.${extFromMime(m.mimeType)}`, {
              type: m.mimeType,
            });
          })()
        : undefined;

      response = await (client.images.edit as any)({
        ...baseParams,
        image: imageFiles.length === 1 ? imageFiles[0] : imageFiles,
        ...(maskFile ? { mask: maskFile } : {}),
      });
    } else {
      response = await (client.images.generate as any)(baseParams);
    }

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
    totalTokens: u.total_tokens,
  };
}

type Usage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
};

function calculateImageCost(modelName: string, usage: Usage) {
  const model = getModel(modelName);
  if (!model || !isImageModel(model)) return undefined;

  const cachedIn = usage.cachedInputTokens ?? 0;
  const textIn = Math.max(0, (usage.inputTokens ?? 0) - cachedIn);
  const imgOut = usage.outputTokens ?? 0;

  const inputCost = round(
    (textIn * (model.inputTokenCost ?? 0)) / 1_000_000,
    6,
  );
  const cachedCost = round(
    (cachedIn * (model.cachedInputTokenCost ?? 0)) / 1_000_000,
    6,
  );
  const outputCost = round(
    (imgOut * (model.outputImageTokenCost ?? 0)) / 1_000_000,
    6,
  );
  const totalCost = round(inputCost + cachedCost + outputCost, 6);
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
  const totalCost = round(model.costPerImage * imageCount, 6);
  return { inputCost: 0, outputCost: totalCost, totalCost, currency: "USD" };
}
