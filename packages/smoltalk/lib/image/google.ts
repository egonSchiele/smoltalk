import { GoogleGenAI } from "@google/genai";
import {
  ImageInput,
  ImageConfig,
  ImageGenResult,
  GeneratedImage,
} from "../image.js";
import { Result, success, failure } from "../types/result.js";
import { getModel, isImageModel } from "../models.js";
import type { ModelDataBlob } from "../modelData.js";
import { normalizeBlob } from "../util/blobRef.js";
import { COST_DECIMAL_PLACES, round } from "../util/util.js";

export async function googleImage(
  input: ImageInput,
  config: ImageConfig,
  apiKey: string,
): Promise<Result<ImageGenResult>> {
  try {
    const normalized = typeof input === "string" ? { prompt: input } : input;
    const client = new GoogleGenAI({ apiKey });

    const parts: any[] = [{ text: normalized.prompt }];
    if (normalized.images && normalized.images.length > 0) {
      const normalizedImages = await Promise.all(
        normalized.images.map((ref) => normalizeBlob(ref)),
      );
      for (const img of normalizedImages) {
        parts.push({
          inlineData: {
            mimeType: img.mimeType,
            data: Buffer.from(img.data).toString("base64"),
          },
        });
      }
    }

    const response = await client.models.generateContent({
      model: config.model,
      contents: [{ role: "user", parts }],
      config: {
        responseModalities: ["IMAGE", "TEXT"],
        ...(config.metadata ?? {}),
      },
    });

    const images: GeneratedImage[] = [];
    for (const candidate of response.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        if (part.inlineData?.data && part.inlineData?.mimeType) {
          images.push({
            data: new Uint8Array(Buffer.from(part.inlineData.data, "base64")),
            mimeType: part.inlineData.mimeType,
          });
        }
      }
    }

    return success({
      images,
      model: config.model,
      costEstimate: calculateGoogleImageCost(config.model, images.length, config.modelData),
    });
  } catch (err) {
    return failure(
      err instanceof Error ? err.message : "Google image request failed",
    );
  }
}

function calculateGoogleImageCost(modelName: string, imageCount: number, modelData?: ModelDataBlob) {
  const model = getModel(modelName, modelData);
  if (!model || !isImageModel(model) || !model.costPerImage) return undefined;
  const totalCost = round(model.costPerImage * imageCount, COST_DECIMAL_PLACES);
  return { inputCost: 0, outputCost: totalCost, totalCost, currency: "USD" };
}
