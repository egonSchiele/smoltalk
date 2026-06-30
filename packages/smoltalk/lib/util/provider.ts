import { getModel } from "../models.js";
import { SmolError } from "../smolError.js";
import type { ModelDataBlob } from "../modelData.js";

/**
 * Resolve the provider for a given model name.
 * If an explicit provider is given, returns it directly.
 * Otherwise looks up the model in the registry.
 */
export function resolveProvider(
  modelName: string,
  explicitProvider?: string,
  modelData?: ModelDataBlob,
): string {
  if (explicitProvider) return explicitProvider;

  const model = getModel(modelName, modelData);
  if (model === undefined) {
    throw new SmolError(
      `Model ${modelName} is not recognized. Please specify a known model, or explicitly set the provider option in the config.`,
    );
  }
  return model.provider;
}

/**
 * Minimal shape needed to read API keys. Kept local to avoid importing
 * SmolConfig (which would create a circular import).
 */
type NestedKeyConfig = {
  apiKey?: {
    openAi?: string;
    google?: string;
    anthropic?: string;
    ollama?: string;
    openRouter?: string;
    deepInfra?: string;
    liteLlm?: string;
    openAiCompat?: string;
  };
};

/**
 * Resolve the API key for a provider, checking config then env vars.
 */
export function resolveApiKey(
  provider: string,
  config: NestedKeyConfig,
): string | undefined {
  const k = config.apiKey;
  switch (provider) {
    case "openai":
    case "openai-responses":
      return k?.openAi || process.env.OPENAI_API_KEY;
    case "google":
      return k?.google || process.env.GEMINI_API_KEY;
    case "anthropic":
      return k?.anthropic || process.env.ANTHROPIC_API_KEY;
    case "ollama":
      return k?.ollama;
    case "openrouter":
      return k?.openRouter || process.env.OPENROUTER_API_KEY;
    case "deepinfra":
      return k?.deepInfra || process.env.DEEPINFRA_API_KEY;
    case "litellm":
      return k?.liteLlm || process.env.LITELLM_API_KEY;
    case "openai-compat":
      return k?.openAiCompat || process.env.OPENAI_COMPAT_API_KEY;
    default:
      return undefined;
  }
}
