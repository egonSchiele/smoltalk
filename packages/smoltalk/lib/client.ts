export * from "./clients/anthropic.js";
export * from "./clients/google.js";
export * from "./clients/openai.js";
export * from "./clients/openaiResponses.js";
export * from "./clients/baseClient.js";
export * from "./clients/ollama.js";
export * from "./clients/openaiCompat.js";
export * from "./clients/openrouter.js";
export * from "./clients/deepinfra.js";
export * from "./clients/litellm.js";
import { SmolAnthropic } from "./clients/anthropic.js";
import { BaseClient } from "./clients/baseClient.js";
import { SmolGoogle } from "./clients/google.js";
import { SmolOllama } from "./clients/ollama.js";
import { SmolOpenAi } from "./clients/openai.js";
import { SmolOpenAiResponses } from "./clients/openaiResponses.js";
import { SmolOpenAiCompat } from "./clients/openaiCompat.js";
import { SmolOpenRouter } from "./clients/openrouter.js";
import { SmolDeepInfra } from "./clients/deepinfra.js";
import { SmolLiteLlm } from "./clients/litellm.js";
import { getModel, isTextModel } from "./models.js";
import { SmolError } from "./smolError.js";
import { SmolClientConfig, SmolConfig } from "./types.js";
import { resolveApiKey, resolveProvider } from "./util/provider.js";

// Null-prototype so provider names like "toString"/"__proto__" can't collide
// with Object.prototype or pollute the registry.
const registeredProviders: Record<string, typeof BaseClient> =
  Object.create(null);

export function registerProvider(
  providerName: string,
  clientClass: typeof BaseClient,
) {
  registeredProviders[providerName] = clientClass;
}

export function unregisterProvider(providerName: string): boolean {
  if (providerName in registeredProviders) {
    delete registeredProviders[providerName];
    return true;
  }
  return false;
}

export function getClient(config: SmolClientConfig) {
  const modelName = config.model;
  const provider = resolveProvider(modelName, config.provider, config.modelData);

  // For getClient, validate that the model is a text model when no explicit
  // provider is given (since this factory only returns text-generation clients).
  if (!config.provider) {
    const model = getModel(modelName, config.modelData);
    if (model && !isTextModel(model)) {
      throw new SmolError(
        `Only text models are supported currently. ${modelName} is a ${model?.type} model.`,
      );
    }
  }

  // Resolve API keys from config or env vars and inject them back into the
  // nested apiKey map. The client constructors also read env vars directly,
  // but this lets getClient surface a clear error before construction.
  const resolvedKeys = {
    openAi: resolveApiKey("openai", config),
    google: resolveApiKey("google", config),
    anthropic: resolveApiKey("anthropic", config),
    ollama: resolveApiKey("ollama", config),
    openRouter: resolveApiKey("openrouter", config),
    deepInfra: resolveApiKey("deepinfra", config),
    liteLlm: resolveApiKey("litellm", config),
    openAiCompat: resolveApiKey("openai-compat", config),
  };
  const clientConfig: SmolConfig = {
    messages: [],
    ...config,
    apiKey: { ...resolvedKeys, ...config.apiKey },
    model: modelName,
    provider,
  };
  switch (provider) {
    case "anthropic":
      if (!resolvedKeys.anthropic) {
        throw new SmolError(
          "No Anthropic API key provided. Please provide an Anthropic API key in the config using apiKey.anthropic, or set the ANTHROPIC_API_KEY environment variable.",
        );
      }
      return new SmolAnthropic(clientConfig);
    case "openai":
      if (!resolvedKeys.openAi) {
        throw new SmolError(
          "No OpenAI API key provided. Please provide an OpenAI API key in the config using apiKey.openAi, or set the OPENAI_API_KEY environment variable.",
        );
      }
      return new SmolOpenAi(clientConfig);
    case "openai-responses":
      if (!resolvedKeys.openAi) {
        throw new SmolError(
          "No OpenAI API key provided. Please provide an OpenAI API key in the config using apiKey.openAi, or set the OPENAI_API_KEY environment variable.",
        );
      }
      return new SmolOpenAiResponses(clientConfig);
    case "google":
      if (!resolvedKeys.google) {
        throw new SmolError(
          "No Google API key provided. Please provide a Google API key in the config using apiKey.google, or set the GEMINI_API_KEY environment variable.",
        );
      }
      return new SmolGoogle(clientConfig);
    case "ollama":
      return new SmolOllama(clientConfig);
    case "openrouter":
      return new SmolOpenRouter(clientConfig);
    case "deepinfra":
      return new SmolDeepInfra(clientConfig);
    case "litellm":
      return new SmolLiteLlm(clientConfig);
    case "openai-compat":
      return new SmolOpenAiCompat(clientConfig);
    default:
      if (provider in registeredProviders) {
        const ClientClass = registeredProviders[provider];
        return new ClientClass(clientConfig);
      }
      throw new SmolError(
        `Model provider ${provider} is not supported. To use a custom provider, register it first via registerProvider(name, ClientClass).`,
      );
  }
}
