import OpenAI from "openai";
import { EmbedConfig, EmbedResult } from "../embed.js";
import { Result, success, failure } from "../types/result.js";
import { getModel, isEmbeddingsModel } from "../models.js";
import type { ModelDataBlob } from "../modelData.js";
import { round } from "../util/util.js";

export type OpenAiEmbedOptions = {
  /**
   * Wire encoding to ask the server for. Left unset, the OpenAI SDK asks for
   * base64 and decodes the reply as base64 no matter what came back, so a
   * server that ignores the field and returns float arrays yields empty
   * vectors. Backends that may not honour base64 (local servers) should
   * pass "float", which the SDK then returns untouched.
   */
  encodingFormat?: "float" | "base64";
};

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
  options?: OpenAiEmbedOptions,
): Promise<Result<EmbedResult>> {
  try {
    const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
    const body: OpenAI.EmbeddingCreateParams = {
      model: config.model,
      input: inputs,
    };
    if (config.dimensions !== undefined) {
      body.dimensions = config.dimensions;
    }
    if (options?.encodingFormat !== undefined) {
      body.encoding_format = options.encodingFormat;
    }
    const response = await client.embeddings.create(body);

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
