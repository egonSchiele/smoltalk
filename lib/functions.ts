// @ts-nocheck
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
} from "./types.js";
import { Result } from "./types/result.js";

function getStrategy(config: SmolPromptConfig): Strategy | null {
  const { model } = config;
  if (model instanceof BaseStrategy) return model;
  if (isStrategy(model)) return fromJSON(model as StrategyJSON);
  return null;
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
  const strategy = getStrategy(config);
  console.log(JSON.stringify(strategy, null, 2));
  exit(0);
  if (strategy) {
    return strategy.text(config);
  }
  const { smolConfig, promptConfig } = splitConfig(config);
  const client = getClient(smolConfig);
  return client.text(promptConfig);
}

export function textSync(
  config: SmolPromptConfig,
): Promise<Result<PromptResult>> {
  const strategy = getStrategy(config);
  if (strategy) {
    return strategy.textSync(config);
  }
  const { smolConfig, promptConfig } = splitConfig(config);
  const client = getClient(smolConfig);
  return client.textSync(promptConfig);
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
