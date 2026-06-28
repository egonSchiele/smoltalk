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

type ApiKeyConfig = {
  openAiApiKey?: string;
  googleApiKey?: string;
  anthropicApiKey?: string;
  ollamaApiKey?: string;
};

/**
 * Resolve the API key for a provider, checking config then env vars.
 */
export function resolveApiKey(
  provider: string,
  config: ApiKeyConfig,
): string | undefined {
  switch (provider) {
    case "openai":
    case "openai-responses":
      return config.openAiApiKey || process.env.OPENAI_API_KEY;
    case "google":
      return config.googleApiKey || process.env.GEMINI_API_KEY;
    case "anthropic":
      return config.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
    case "ollama":
      return config.ollamaApiKey;
    default:
      return undefined;
  }
}
