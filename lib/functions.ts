import { exit } from "process";
import { getClient } from "./client.js";
import { Model } from "./model.js";
import { BaseStrategy } from "./strategies/baseStrategy.js";
import {
  fromJSON,
  isStrategy,
  Strategy,
  StrategyJSON,
} from "./strategies/index.js";
import {
  SmolPromptConfig,
  PromptResult,
  StreamChunk,
  PromptConfig,
  ModelLike,
  ModelParam,
  ModelNameAndProviderSchema,
} from "./types.js";
import { Result } from "./types/result.js";
import { ModelName } from "./models.js";

function getStrategy(model: ModelParam): Strategy {
  if (model instanceof BaseStrategy) return model;
  const nameAndProvider = ModelNameAndProviderSchema.safeParse(model);
  if (nameAndProvider.success) {
    const { modelName, provider } = nameAndProvider.data;
    return fromJSON({ type: "id", params: { model: modelName } }) as Strategy;
  }
  return fromJSON(model as StrategyJSON);
}

export function splitConfig(config: SmolPromptConfig): {
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
    statelog,
    ...promptConfig
  } = config;

  const _model = new Model(rawModel as any);
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
  const strategy = getStrategy(config.model);
  return strategy.text(config);
}

export function textSync(
  config: SmolPromptConfig,
): Promise<Result<PromptResult>> {
  const strategy = getStrategy(config.model);
  return strategy.textSync(config);
}

export function textStream(
  config: SmolPromptConfig,
): AsyncGenerator<StreamChunk> {
  const { smolConfig, promptConfig } = splitConfig(config);
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
