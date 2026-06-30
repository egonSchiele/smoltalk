import type { ModelDataBlob } from "./modelData.js";
import { Result, failure } from "./types/result.js";
import { TokenUsage } from "./types/tokenUsage.js";
import { CostEstimate } from "./types/costEstimate.js";
import { resolveProvider, resolveApiKey } from "./util/provider.js";
import { openaiEmbed } from "./embed/openai.js";
import { googleEmbed } from "./embed/google.js";
import { ollamaEmbed } from "./embed/ollama.js";
import { openaiCompatEmbed } from "./embed/openaiCompat.js";

export type EmbedConfig = {
  model: string;
  provider?: string;
  dimensions?: number;

  /** API keys, nested by provider. Falls back to env vars
   *  (OPENAI_API_KEY / GEMINI_API_KEY / DEEPINFRA_API_KEY /
   *  LITELLM_API_KEY / OPENAI_COMPAT_API_KEY). */
  apiKey?: {
    openAi?: string;
    google?: string;
    ollama?: string;
    deepInfra?: string;
    liteLlm?: string;
    openAiCompat?: string;
  };

  /** Custom base URLs, nested by provider. */
  baseUrl?: {
    ollama?: string;
    deepInfra?: string;
    liteLlm?: string;
    openAiCompat?: string;
  };

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

export type EmbedProvider = (
  inputs: string[],
  config: EmbedConfig,
) => Promise<Result<EmbedResult>>;

// Null-prototype so provider names like "toString"/"__proto__" can't collide
// with Object.prototype or pollute the registry.
const registeredEmbedProviders: Record<string, EmbedProvider> =
  Object.create(null);

export function registerEmbeddingProvider(name: string, fn: EmbedProvider): void {
  registeredEmbedProviders[name] = fn;
}

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
          "No OpenAI API key provided. Set config.apiKey.openAi or the OPENAI_API_KEY environment variable.",
        );
      }
      return openaiEmbed(inputs, config, apiKey);
    }
    case "google": {
      if (!apiKey) {
        return failure(
          "No Google API key provided. Set config.apiKey.google or the GEMINI_API_KEY environment variable.",
        );
      }
      return googleEmbed(inputs, config, apiKey);
    }
    case "ollama": {
      const host =
        config.baseUrl?.ollama || process.env.OLLAMA_HOST;
      return ollamaEmbed(inputs, config, apiKey, host);
    }
    case "openrouter":
      return failure(
        "openrouter does not expose an embeddings endpoint; use deepinfra, openai-compat, or litellm instead.",
      );
    case "deepinfra": {
      if (!apiKey) {
        return failure(
          "No DeepInfra API key provided. Set config.apiKey.deepInfra or the DEEPINFRA_API_KEY environment variable.",
        );
      }
      const baseURL =
        config.baseUrl?.deepInfra || "https://api.deepinfra.com/v1/openai";
      return openaiCompatEmbed(inputs, config, apiKey, baseURL);
    }
    case "litellm": {
      if (!apiKey) {
        return failure(
          "No LiteLLM API key provided. Set config.apiKey.liteLlm or the LITELLM_API_KEY environment variable.",
        );
      }
      const baseURL =
        config.baseUrl?.liteLlm || process.env.LITELLM_BASE_URL;
      if (!baseURL) {
        return failure(
          "No LiteLLM base URL provided. Set config.baseUrl.liteLlm or the LITELLM_BASE_URL environment variable.",
        );
      }
      return openaiCompatEmbed(inputs, config, apiKey, baseURL);
    }
    case "openai-compat": {
      if (!apiKey) {
        return failure(
          "No openai-compat API key provided. Set config.apiKey.openAiCompat or the OPENAI_COMPAT_API_KEY environment variable.",
        );
      }
      const baseURL =
        config.baseUrl?.openAiCompat || process.env.OPENAI_COMPAT_BASE_URL;
      if (!baseURL) {
        return failure(
          "No openai-compat base URL provided. Set config.baseUrl.openAiCompat or the OPENAI_COMPAT_BASE_URL environment variable.",
        );
      }
      return openaiCompatEmbed(inputs, config, apiKey, baseURL);
    }
    default: {
      const custom = registeredEmbedProviders[provider];
      if (custom) {
        return custom(inputs, config);
      }
      return failure(
        `Provider "${provider}" does not support embeddings. Register one with registerEmbeddingProvider(name, fn).`,
      );
    }
  }
}
