import { EmbedConfig, EmbedResult } from "../embed.js";
import { Result, success } from "../types/result.js";
import { openaiEmbed } from "./openai.js";

/**
 * Embeddings from an MLX server on localhost (`agency local serve
 * --embedding …`, or any server with an OpenAI-shaped /v1/embeddings
 * route). The same call the OpenAI helper makes, with the two things the
 * chat client also fixes: the key is a placeholder the server ignores, and
 * the cost is zero. `dimensions` is passed through as-is; whether the
 * server honours it depends on the server and model.
 *
 * Float encoding is requested explicitly. The SDK otherwise asks for base64
 * and decodes the reply as base64 unconditionally, so a local server that
 * ignores the field and returns float arrays would yield empty vectors.
 */
export async function mlxEmbed(
  inputs: string[],
  config: EmbedConfig,
  baseURL: string,
): Promise<Result<EmbedResult>> {
  const result = await openaiEmbed(inputs, config, "mlx-local", baseURL, {
    encodingFormat: "float",
  });
  if (!result.success) {
    return result;
  }
  return success({
    ...result.value,
    costEstimate: { inputCost: 0, outputCost: 0, totalCost: 0, currency: "USD" },
  });
}
