import { getClient } from "./client.js";
import { Model } from "./model.js";
import { BaseStrategy } from "./strategies/baseStrategy.js";
import { fromJSON, Strategy, StrategyJSON } from "./strategies/index.js";
import {
  SmolPromptConfig,
  PromptResult,
  StreamChunk,
  PromptConfig,
} from "./types.js";
import { Result } from "./types/result.js";

function hydrateStrategy(config: SmolPromptConfig): SmolPromptConfig {
  if (config.strategy && !(config.strategy instanceof BaseStrategy)) {
    return { ...config, strategy: fromJSON(config.strategy as StrategyJSON) };
  }
  return config;
}

function splitConfig(config: SmolPromptConfig): {
  smolConfig: Parameters<typeof getClient>[0];
  promptConfig: PromptConfig;
} {
  const {
    openAiApiKey,
    googleApiKey,
    ollamaApiKey,
    anthropicApiKey,
    ollamaHost,
    model: rawModel,
    provider,
    logLevel,
    toolLoopDetection,
    statelog,
    ...promptConfig
  } = config;

  const _model = new Model(rawModel);
  const model = _model.getResolvedModel();

  return {
    smolConfig: {
      openAiApiKey,
      googleApiKey,
      ollamaApiKey,
      anthropicApiKey,
      ollamaHost,
      model,
      provider,
      logLevel,
      toolLoopDetection,
      statelog,
    },
    promptConfig,
  };
}

export function text(
  config: SmolPromptConfig & { stream: true },
): AsyncGenerator<StreamChunk>;
export function text(
  config: SmolPromptConfig & { stream?: false },
): Promise<Result<PromptResult>>;
export function text(
  config: SmolPromptConfig,
): Promise<Result<PromptResult>> | AsyncGenerator<StreamChunk> {
  config = hydrateStrategy(config);
  if (config.strategy) {
    return (config.strategy as Strategy).text(config);
  }
  const { smolConfig, promptConfig } = splitConfig(config);
  const client = getClient(smolConfig);
  return client.text(promptConfig);
}

export function textSync(
  config: SmolPromptConfig,
): Promise<Result<PromptResult>> {
  config = hydrateStrategy(config);
  if (config.strategy) {
    return (config.strategy as Strategy).textSync(config);
  }
  const { smolConfig, promptConfig } = splitConfig(config);
  const client = getClient(smolConfig);
  return client.textSync(promptConfig);
}

export function textStream(
  config: SmolPromptConfig,
): AsyncGenerator<StreamChunk> {
  config = hydrateStrategy(config);
  /*   if (config.strategy) {
    return (config.strategy as import("./strategies/types.js").Strategy).textStream(config);
  }
 */ const { smolConfig, promptConfig } = splitConfig(config);
  const client = getClient(smolConfig);
  return client.textStream(promptConfig);
}

export function prompt(
  promptText: string,
  config: SmolPromptConfig,
): Promise<Result<PromptResult>> | AsyncGenerator<StreamChunk> {
  const { smolConfig, promptConfig } = splitConfig(config);
  const client = getClient(smolConfig);
  return client.prompt(promptText, promptConfig);
}
