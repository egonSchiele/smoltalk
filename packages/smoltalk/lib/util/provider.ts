import { env } from "#platform";
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
 * Minimal shape needed to read API keys / base URLs. Kept local to avoid
 * importing SmolConfig (which would create a circular import).
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
    groq?: string;
    typesafe?: string;
    /** Arbitrary provider names, for keys targeting a custom-registered provider. */
    [provider: string]: string | undefined;
  };
  baseUrl?: {
    /** Only decide() reads this; see the "openai" case of resolveBaseUrl. */
    openAi?: string;
    ollama?: string;
    openRouter?: string;
    deepInfra?: string;
    liteLlm?: string;
    openAiCompat?: string;
    mlx?: string;
    typesafe?: string;
    laya?: string;
  };
};

/**
 * Resolve the API key for a provider, checking config then env vars.
 * In a browser `env` answers nothing, so the caller passes the key.
 */
export function resolveApiKey(
  provider: string,
  config: NestedKeyConfig,
): string | undefined {
  const k = config.apiKey;
  switch (provider) {
    case "openai":
    case "openai-responses":
      return k?.openAi || env("OPENAI_API_KEY");
    case "google":
      return k?.google || env("GEMINI_API_KEY");
    case "anthropic":
      return k?.anthropic || env("ANTHROPIC_API_KEY");
    case "ollama":
      return k?.ollama;
    case "openrouter":
      return k?.openRouter || env("OPENROUTER_API_KEY");
    case "deepinfra":
      return k?.deepInfra || env("DEEPINFRA_API_KEY");
    case "litellm":
      return k?.liteLlm || env("LITELLM_API_KEY");
    case "openai-compat":
      return k?.openAiCompat || env("OPENAI_COMPAT_API_KEY");
    case "groq":
      return k?.groq || env("GROQ_API_KEY");
    case "typesafe":
      return k?.typesafe || env("TYPESAFE_API_KEY");
    default:
      return config.apiKey?.[provider];
  }
}

/**
 * Resolve the base URL for a provider, checking config then env vars then a
 * baked-in default. Returns `undefined` when a provider requires the caller to
 * supply one (litellm, openai-compat) and nothing was given.
 *
 * Centralized here so we don't duplicate the env-fallback table across
 * embed.ts, image.ts, and each client constructor.
 */
export function resolveBaseUrl(
  provider: string,
  config: NestedKeyConfig,
): string | undefined {
  const b = config.baseUrl;
  switch (provider) {
    case "ollama":
      return b?.ollama || env("OLLAMA_HOST");
    case "openrouter":
      return b?.openRouter || "https://openrouter.ai/api/v1";
    case "deepinfra":
      return b?.deepInfra || "https://api.deepinfra.com/v1/openai";
    case "litellm":
      return b?.liteLlm || env("LITELLM_BASE_URL");
    case "openai-compat":
      return b?.openAiCompat || env("OPENAI_COMPAT_BASE_URL");
    case "mlx":
      return b?.mlx || env("MLX_BASE_URL") || "http://127.0.0.1:8080/v1";
    case "openai":
      // Only decide() uses this case. openaiEmbed treats any base URL as a
      // sign of a non-OpenAI server, so passing "openai" here from the
      // embedding path would change its behavior.
      return b?.openAi || "https://api.openai.com/v1";
    case "typesafe":
      return b?.typesafe || env("TYPESAFE_BASE_URL") || "https://api.typesafe.ai";
    case "laya":
      // Laya's own server, `laya-serve`, listens on port 8000.
      return b?.laya || env("LAYA_BASE_URL") || "http://127.0.0.1:8000";
    default:
      return undefined;
  }
}
