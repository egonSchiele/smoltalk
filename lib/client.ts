export * from "./clients/anthropic.js";
export * from "./clients/google.js";
export * from "./clients/openai.js";
export * from "./clients/openaiResponses.js";
export * from "./clients/baseClient.js";
export * from "./clients/ollama.js";
export * from "./clients/llamaCpp.js";
import { SmolAnthropic } from "./clients/anthropic.js";
import { BaseClient } from "./clients/baseClient.js";
import { SmolGoogle } from "./clients/google.js";
import { LlamaCPP } from "./clients/llamaCpp.js";
import { SmolOllama } from "./clients/ollama.js";
import { SmolOpenAi } from "./clients/openai.js";
import { SmolOpenAiResponses } from "./clients/openaiResponses.js";
import { getModel, isTextModel } from "./models.js";
import { SmolError } from "./smolError.js";
import { SmolClientConfig, SmolConfig } from "./types.js";

const registeredProviders: Record<string, typeof BaseClient> = {};

export function registerProvider(
  providerName: string,
  clientClass: typeof BaseClient,
) {
  registeredProviders[providerName] = clientClass;
}

export function getClient(config: SmolClientConfig) {
  let provider = config.provider;
  const modelName = config.model;
  if (!provider) {
    const model = getModel(modelName);
    if (model === undefined) {
      throw new SmolError(
        `Model ${modelName} is not recognized. Please specify a known model, or explicitly set the provider option in the config.`,
      );
    }
    if (!isTextModel(model)) {
      throw new SmolError(
        `Only text models are supported currently. ${modelName} is a ${model?.type} model.`,
      );
    }
    provider = model.provider;
  }

  const resolvedKeys = {
    openAiApiKey: config.openAiApiKey || process.env.OPENAI_API_KEY,
    googleApiKey: config.googleApiKey || process.env.GEMINI_API_KEY,
    anthropicApiKey: config.anthropicApiKey || process.env.ANTHROPIC_API_KEY,
  };
  const clientConfig: SmolConfig = {
    messages: [],
    ...config,
    ...resolvedKeys,
    model: modelName,
  };
  switch (provider) {
    case "anthropic":
      if (!resolvedKeys.anthropicApiKey) {
        throw new SmolError(
          "No Anthropic API key provided. Please provide an Anthropic API key in the config using anthropicApiKey, or set the ANTHROPIC_API_KEY environment variable.",
        );
      }
      return new SmolAnthropic({
        ...clientConfig,
        anthropicApiKey: resolvedKeys.anthropicApiKey,
      });
    case "openai":
      if (!resolvedKeys.openAiApiKey) {
        throw new SmolError(
          "No OpenAI API key provided. Please provide an OpenAI API key in the config using openAiApiKey, or set the OPENAI_API_KEY environment variable.",
        );
      }
      return new SmolOpenAi(clientConfig);
    case "openai-responses":
      if (!resolvedKeys.openAiApiKey) {
        throw new SmolError(
          "No OpenAI API key provided. Please provide an OpenAI API key in the config using openAiApiKey, or set the OPENAI_API_KEY environment variable.",
        );
      }
      return new SmolOpenAiResponses(clientConfig);
    case "google":
      if (!resolvedKeys.googleApiKey) {
        throw new SmolError(
          "No Google API key provided. Please provide a Google API key in the config using googleApiKey, or set the GEMINI_API_KEY environment variable.",
        );
      }
      return new SmolGoogle(clientConfig);
    case "ollama":
      return new SmolOllama(clientConfig);
    case "llama-cpp":
      return new LlamaCPP(clientConfig);
    default:
      if (provider in registeredProviders) {
        const ClientClass = registeredProviders[provider];
        return new ClientClass(clientConfig);
      }
      throw new SmolError(`Model provider ${provider} is not supported.`);
  }
}
