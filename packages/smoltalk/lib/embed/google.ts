import { GoogleGenAI } from "@google/genai";
import { EmbedConfig, EmbedResult } from "../embed.js";
import { Result, success, failure } from "../types/result.js";

export async function googleEmbed(
  inputs: string[],
  config: EmbedConfig,
  apiKey: string,
): Promise<Result<EmbedResult>> {
  try {
    const client = new GoogleGenAI({ apiKey });
    const response = await client.models.embedContent({
      model: config.model,
      contents: inputs,
      ...(config.dimensions !== undefined
        ? { config: { outputDimensionality: config.dimensions } }
        : {}),
    });

    const embeddings = (response.embeddings ?? []).map((e) => e.values ?? []);

    return success({
      embeddings,
      model: config.model,
      // Google Gemini embeddings API does not return token usage in the
      // response. Cost cannot be auto-computed without a separate
      // countTokens() call.
    });
  } catch (err) {
    return failure(
      err instanceof Error ? err.message : "Google embedding request failed",
    );
  }
}
