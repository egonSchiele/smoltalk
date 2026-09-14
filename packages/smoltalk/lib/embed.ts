import type { ModelDataBlob } from "./modelData.js";
import { Result, failure } from "./types/result.js";
import { TokenUsage } from "./types/tokenUsage.js";
import { CostEstimate } from "./types/costEstimate.js";
import { resolveProvider, resolveApiKey, resolveBaseUrl } from "./util/provider.js";
import { openaiEmbed } from "./embed/openai.js";
import { googleEmbed } from "./embed/google.js";
import { ollamaEmbed } from "./embed/ollama.js";
import { mlxEmbed } from "./embed/mlx.js";
import { loadLlamaCpp } from "./clients/llamaCppLoader.js";
import type { LlamaCppModule } from "./clients/llamaCppLoader.js";

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

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
    /** Arbitrary provider names, for keys targeting a custom-registered provider. */
    [provider: string]: string | undefined;
  };

  /** Custom base URLs, nested by provider. */
  baseUrl?: {
    ollama?: string;
    deepInfra?: string;
    liteLlm?: string;
    openAiCompat?: string;
    mlx?: string;
    /** Arbitrary provider names, for URLs targeting a custom-registered provider. */
    [provider: string]: string | undefined;
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

/** True when `name` has an embed provider registered through
 *  registerEmbeddingProvider. The built-in cases in embed() are not its
 *  concern, the same as hasProvider in client.ts. */
export function hasEmbeddingProvider(name: string): boolean {
  return name in registeredEmbedProviders;
}

export function unregisterEmbeddingProvider(name: string): boolean {
  if (name in registeredEmbedProviders) {
    delete registeredEmbedProviders[name];
    return true;
  }
  return false;
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
    case "ollama":
      return ollamaEmbed(inputs, config, apiKey, resolveBaseUrl("ollama", config));
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
      return openaiEmbed(inputs, config, apiKey, resolveBaseUrl("deepinfra", config));
    }
    case "litellm": {
      if (!apiKey) {
        return failure(
          "No LiteLLM API key provided. Set config.apiKey.liteLlm or the LITELLM_API_KEY environment variable.",
        );
      }
      const baseURL = resolveBaseUrl("litellm", config);
      if (!baseURL) {
        return failure(
          "No LiteLLM base URL provided. Set config.baseUrl.liteLlm or the LITELLM_BASE_URL environment variable.",
        );
      }
      return openaiEmbed(inputs, config, apiKey, baseURL);
    }
    case "openai-compat": {
      if (!apiKey) {
        return failure(
          "No openai-compat API key provided. Set config.apiKey.openAiCompat or the OPENAI_COMPAT_API_KEY environment variable.",
        );
      }
      const baseURL = resolveBaseUrl("openai-compat", config);
      if (!baseURL) {
        return failure(
          "No openai-compat base URL provided. Set config.baseUrl.openAiCompat or the OPENAI_COMPAT_BASE_URL environment variable.",
        );
      }
      return openaiEmbed(inputs, config, apiKey, baseURL);
    }
    case "mlx": {
      // resolveBaseUrl always returns a value for "mlx" (it has a default).
      return mlxEmbed(inputs, config, resolveBaseUrl("mlx", config)!);
    }
    case "llama-cpp": {
      // A hand-registered provider wins, the same rule loadLlamaCpp applies
      // to the chat class. Otherwise load the plugin the way text() does;
      // the loader caches its import.
      const custom = registeredEmbedProviders[provider];
      if (custom) {
        return custom(inputs, config);
      }
      let plugin: LlamaCppModule;
      try {
        plugin = await loadLlamaCpp();
      } catch (err) {
        return failure(errorMessage(err));
      }
      if (typeof plugin.embed !== "function") {
        return failure(
          "Your installed smoltalk-llama-cpp has no embeddings support. " +
            "Upgrade it (npm i smoltalk-llama-cpp@latest; >=0.5.0 required).",
        );
      }
      return plugin.embed(inputs, config);
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
