import { Provider } from "./models.js";
import type { ModelDataBlob } from "./modelData.js";
import { Result, failure } from "./types/result.js";
import { TokenUsage } from "./types/tokenUsage.js";
import { CostEstimate } from "./types/costEstimate.js";
import { resolveProvider, resolveApiKey } from "./util/provider.js";
import { openaiEmbed } from "./embed/openai.js";
import { googleEmbed } from "./embed/google.js";
import { ollamaEmbed } from "./embed/ollama.js";

export type EmbedConfig = {
  model: string;
  provider?: Provider;
  dimensions?: number;

  // API keys
  openAiApiKey?: string;
  googleApiKey?: string;
  ollamaApiKey?: string;

  // Ollama-specific
  ollamaHost?: string;

  // Plugin support
  metadata?: Record<string, unknown>;

  // Refreshed model data to layer over the baked-in registry.
  modelData?: ModelDataBlob;
};

export type EmbedResult = {
  embeddings: number[][];
  model: string;
  tokenUsage?: TokenUsage;
  costEstimate?: CostEstimate;
};

export async function embed(
  input: string | string[],
  config: EmbedConfig,
): Promise<Result<EmbedResult>> {
  const inputs = Array.isArray(input) ? input : [input];

  let provider: string;
  try {
    provider = resolveProvider(config.model, config.provider, config.modelData);
  } catch (err) {
    return failure(
      err instanceof Error ? err.message : "Failed to resolve provider",
    );
  }

  const apiKey = resolveApiKey(provider, config);

  switch (provider) {
    case "openai":
    case "openai-responses": {
      if (!apiKey) {
        return failure(
          "No OpenAI API key provided. Set openAiApiKey in config or the OPENAI_API_KEY environment variable.",
        );
      }
      return openaiEmbed(inputs, config, apiKey);
    }
    case "google": {
      if (!apiKey) {
        return failure(
          "No Google API key provided. Set googleApiKey in config or the GEMINI_API_KEY environment variable.",
        );
      }
      return googleEmbed(inputs, config, apiKey);
    }
    case "ollama":
      return ollamaEmbed(inputs, config, apiKey, config.ollamaHost);
    default:
      return failure(
        `Provider "${provider}" does not support embeddings`,
      );
  }
}
