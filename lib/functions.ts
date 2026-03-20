import {
  BaseMessage,
  Message,
  messageFromJSON,
} from "./classes/message/index.js";
import { getClient } from "./client.js";
import { Model } from "./model.js";
import { BaseStrategy } from "./strategies/baseStrategy.js";
import { fromJSON, Strategy, StrategyJSON } from "./strategies/index.js";
import {
  ModelParam,
  PromptConfig,
  PromptResult,
  SmolPromptConfig,
  StreamChunk,
} from "./types.js";
import { Result } from "./types/result.js";
import { getLogger } from "./util/logger.js";

function getStrategy(model: ModelParam): Strategy {
  if (model instanceof BaseStrategy) return model;
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
    metadata,
    hooks,
    llamaCppModelDir,
    middleware,
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
      metadata,
      hooks,
      llamaCppModelDir,
    },
    promptConfig,
  };
}

function fixMessagesIfNecessary(messages: any[]): Message[] {
  if (messages && messages.length > 0) {
    if (!(messages[0] instanceof BaseMessage)) {
      getLogger().warn("Messages are not instances of smoltalk.BaseMessage");
      return messages.map((m) => messageFromJSON(m));
    }
  }
  return messages;
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
  config.messages = fixMessagesIfNecessary(config.messages);
  return strategy.text(config);
}

export function textSync(
  config: SmolPromptConfig,
): Promise<Result<PromptResult>> {
  const strategy = getStrategy(config.model);
  config.messages = fixMessagesIfNecessary(config.messages);
  return strategy.textSync(config);
}

export function textStream(
  config: SmolPromptConfig,
): AsyncGenerator<StreamChunk> {
  const strategy = getStrategy(config.model);
  config.messages = fixMessagesIfNecessary(config.messages);
  return strategy.textStream(config);
}
