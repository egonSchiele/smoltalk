export * from "./clients/anthropic.js";
export * from "./clients/google.js";
export * from "./clients/openai.js";
export * from "./clients/openaiResponses.js";
import { SmolAnthropic } from "./clients/anthropic.js";
import { BaseClient } from "./clients/baseClient.js";
import { SmolGoogle } from "./clients/google.js";
import { SmolOllama } from "./clients/ollama.js";
import { SmolOpenAi } from "./clients/openai.js";
import { SmolOpenAiResponses } from "./clients/openaiResponses.js";
import { getModel, isTextModel } from "./models.js";
import { SmolError } from "./smolError.js";
import { ResolvedSmolConfig } from "./types.js";

const registeredProviders: Record<string, typeof BaseClient> = {};

export function registerProvider(
  providerName: string,
  clientClass: typeof BaseClient,
) {
  registeredProviders[providerName] = clientClass;
}

export function getClient(config: ResolvedSmolConfig) {
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

  const clientConfig: ResolvedSmolConfig = { ...config, model: modelName };
  switch (provider) {
    case "anthropic":
      if (!config.anthropicApiKey) {
        throw new SmolError(
          "No Anthropic API key provided. Please provide an Anthropic API key in the config using anthropicApiKey.",
        );
      }
      return new SmolAnthropic({
        ...clientConfig,
        anthropicApiKey: config.anthropicApiKey,
      });
    case "openai":
      if (!config.openAiApiKey) {
        throw new SmolError(
          "No OpenAI API key provided. Please provide an OpenAI API key in the config using openAiApiKey.",
        );
      }
      return new SmolOpenAi(clientConfig);
    case "openai-responses":
      if (!config.openAiApiKey) {
        throw new SmolError(
          "No OpenAI API key provided. Please provide an OpenAI API key in the config using openAiApiKey.",
        );
      }
      return new SmolOpenAiResponses(clientConfig);
    case "google":
      if (!config.googleApiKey) {
        throw new SmolError(
          "No Google API key provided. Please provide a Google API key in the config using googleApiKey.",
        );
      }
      return new SmolGoogle(clientConfig);
    case "ollama":
      return new SmolOllama(clientConfig);
    default:
      if (provider in registeredProviders) {
        const ClientClass = registeredProviders[provider];
        return new ClientClass(clientConfig);
      }
      throw new SmolError(`Model provider ${provider} is not supported.`);
  }
}
