import { getClient } from "./client.js";
import { isModelConfig, pickModel } from "./models.js";
import {
  SmolPromptConfig,
  PromptResult,
  StreamChunk,
  PromptConfig,
} from "./types.js";
import { Result } from "./types/result.js";

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

  const model = isModelConfig(rawModel) ? pickModel(rawModel) : rawModel;

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
  const { smolConfig, promptConfig } = splitConfig(config);
  const client = getClient(smolConfig);
  return client.text(promptConfig);
}

export function textSync(
  config: SmolPromptConfig,
): Promise<Result<PromptResult>> {
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
