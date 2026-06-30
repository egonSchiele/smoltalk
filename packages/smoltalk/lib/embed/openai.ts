import OpenAI from "openai";
import { EmbedConfig, EmbedResult } from "../embed.js";
import { Result, success, failure } from "../types/result.js";
import { getModel, isEmbeddingsModel } from "../models.js";
import type { ModelDataBlob } from "../modelData.js";
import { round } from "../util/util.js";

/**
 * OpenAI-compatible embedding call. Used by openai directly and by other
 * OpenAI-shape backends (deepinfra, litellm, openai-compat) which pass a
 * custom `baseURL`. Cost comes from the smoltalk model registry; provider-
 * returned cost fields aren't standardized on this endpoint.
 */
export async function openaiEmbed(
  inputs: string[],
  config: EmbedConfig,
  apiKey: string,
  baseURL?: string,
): Promise<Result<EmbedResult>> {
  try {
    const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
    const response = await client.embeddings.create({
      model: config.model,
      input: inputs,
      ...(config.dimensions !== undefined
        ? { dimensions: config.dimensions }
        : {}),
    });

    const embeddings = [...response.data]
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);

    const inputTokens = response.usage.prompt_tokens;
    const costEstimate = calculateEmbeddingCost(config.model, inputTokens, config.modelData);

    return success({
      embeddings,
      model: response.model,
      tokenUsage: { inputTokens, outputTokens: 0 },
      costEstimate,
    });
  } catch (err) {
    return failure(
      err instanceof Error ? err.message : "OpenAI embedding request failed",
    );
  }
}

function calculateEmbeddingCost(modelName: string, inputTokens: number, modelData?: ModelDataBlob) {
  const model = getModel(modelName, modelData);
  if (!model || !isEmbeddingsModel(model) || !model.tokenCost) return undefined;

  const inputCost = round((inputTokens * model.tokenCost) / 1_000_000, 6);
  return {
    inputCost,
    outputCost: 0,
    totalCost: inputCost,
    currency: "USD",
  };
}
