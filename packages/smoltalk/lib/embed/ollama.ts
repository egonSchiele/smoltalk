import { Ollama } from "ollama";
import { EmbedConfig, EmbedResult } from "../embed.js";
import { Result, success, failure } from "../types/result.js";
import { DEFAULT_OLLAMA_HOST } from "../clients/ollama.js";

export async function ollamaEmbed(
  inputs: string[],
  config: EmbedConfig,
  apiKey?: string,
  ollamaHost?: string,
): Promise<Result<EmbedResult>> {
  try {
    let client: Ollama;
    if (apiKey) {
      client = new Ollama({
        host: "https://cloud.ollama.com",
        headers: { Authorization: "Bearer " + apiKey },
      });
    } else {
      client = new Ollama({ host: ollamaHost || DEFAULT_OLLAMA_HOST });
    }

    const response = await client.embed({
      model: config.model,
      input: inputs,
      ...(config.dimensions !== undefined
        ? { dimensions: config.dimensions }
        : {}),
    });

    return success({
      embeddings: response.embeddings,
      model: response.model,
      tokenUsage: {
        inputTokens: response.prompt_eval_count ?? 0,
        outputTokens: 0,
      },
    });
  } catch (err) {
    return failure(
      err instanceof Error ? err.message : "Ollama embedding request failed",
    );
  }
}
