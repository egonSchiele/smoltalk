import {
  BaseMessage,
  Message,
  messageFromJSON,
} from "./classes/message/index.js";
import { getClient } from "./client.js";
import { executeMiddlewareSync, executeMiddlewareStream } from "./middleware.js";
import { Model } from "./model.js";
import {
  PromptConfig,
  PromptResult,
  SmolPromptConfig,
  StreamChunk,
} from "./types.js";
import { Result } from "./types/result.js";
import { getLogger } from "./util/logger.js";

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

function runSync(config: SmolPromptConfig): Promise<Result<PromptResult>> {
  const { smolConfig, promptConfig } = splitConfig(config);
  return getClient(smolConfig).textSync(promptConfig);
}

function runStream(config: SmolPromptConfig): AsyncGenerator<StreamChunk> {
  const { smolConfig, promptConfig } = splitConfig(config);
  return getClient(smolConfig).textStream(promptConfig);
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
  if (config.stream) return textStream(config);
  return textSync(config);
}

export async function textSync(
  config: SmolPromptConfig,
): Promise<Result<PromptResult>> {
  config.messages = fixMessagesIfNecessary(config.messages);

  if (config.middleware && config.middleware.checks.length > 0) {
    const middlewareResult = await executeMiddlewareSync(config, runSync, runSync);
    if (middlewareResult) return middlewareResult;
  }

  const { middleware: _, ...rest } = config;
  return runSync(rest as SmolPromptConfig);
}

export async function* textStream(
  config: SmolPromptConfig,
): AsyncGenerator<StreamChunk> {
  config.messages = fixMessagesIfNecessary(config.messages);

  if (config.middleware && config.middleware.checks.length > 0) {
    yield* executeMiddlewareStream(config, runStream, runSync);
    return;
  }

  const { middleware: _, ...rest } = config;
  yield* runStream(rest as SmolPromptConfig);
}
