import OpenAI from "openai";
import { EmbedConfig, EmbedResult } from "../embed.js";
import { Result, success, failure } from "../types/result.js";
import { getModel, isEmbeddingsModel } from "../models.js";
import type { ModelDataBlob } from "../modelData.js";
import { round } from "../util/util.js";

export type OpenAiEmbedOptions = {
  /**
   * Wire encoding to ask the server for. Left unset, real OpenAI (no
   * baseURL) keeps the SDK's base64 default, and every other backend gets
   * "float": the SDK decodes an unrequested reply as base64 no matter what
   * came back, so a server that ignores the field and returns float arrays
   * would yield empty vectors. Set explicitly to override either default.
   */
  encodingFormat?: "float" | "base64";
};

/**
 * A server may answer a float request with base64 anyway (some always
 * encode). Once we name an encoding the SDK returns the body untouched, so
 * handle both shapes here. Little-endian float32, the same layout the SDK's
 * own decoder assumes.
 */
function toFloats(embedding: number[] | string): number[] {
  if (typeof embedding === "string") {
    const bytes = Buffer.from(embedding, "base64");
    const view = new Float32Array(
      bytes.buffer,
      bytes.byteOffset,
      Math.floor(bytes.byteLength / 4),
    );
    return Array.from(view);
  }
  return embedding;
}

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
    let encodingFormat = options?.encodingFormat;
    if (encodingFormat === undefined && baseURL !== undefined) {
      encodingFormat = "float";
    }
    if (encodingFormat !== undefined) {
      body.encoding_format = encodingFormat;
    }
    const response = await client.embeddings.create(body);

    const embeddings = [...response.data]
      .sort((a, b) => a.index - b.index)
      .map((d) => toFloats(d.embedding as number[] | string));

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
