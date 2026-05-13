import OpenAI from "openai";
import { EmbedConfig, EmbedResult } from "../embed.js";
import { Result, success, failure } from "../types/result.js";
import { getModel, isEmbeddingsModel } from "../models.js";
import { round } from "../util/util.js";

export async function openaiEmbed(
  inputs: string[],
  config: EmbedConfig,
  apiKey: string,
): Promise<Result<EmbedResult>> {
  try {
    const client = new OpenAI({ apiKey });
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
    const costEstimate = calculateEmbeddingCost(config.model, inputTokens);

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

function calculateEmbeddingCost(modelName: string, inputTokens: number) {
  const model = getModel(modelName);
  if (!model || !isEmbeddingsModel(model) || !model.tokenCost) return undefined;

  const inputCost = round((inputTokens * model.tokenCost) / 1_000_000, 6);
  return {
    inputCost,
    outputCost: 0,
    totalCost: inputCost,
    currency: "USD",
  };
}
