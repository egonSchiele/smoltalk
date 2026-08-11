import {
  BaseMessage,
  Message,
  messageFromJSON,
} from "./classes/message/index.js";
import { getClient, hasProvider } from "./client.js";
import { loadLlamaCpp } from "./clients/llamaCppLoader.js";
import {
  PromptResult,
  SmolConfig,
  StreamChunk,
} from "./types.js";
import { Result } from "./types/result.js";
import { getLogger } from "./util/logger.js";

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
  config: SmolConfig & { stream: true },
): AsyncGenerator<StreamChunk>;
export function text(
  config: SmolConfig & { stream?: false },
): Promise<Result<PromptResult>>;
export function text(
  config: SmolConfig,
): Promise<Result<PromptResult>> | AsyncGenerator<StreamChunk> {
  if (config.stream) return textStream(config);
  return textSync(config);
}

export async function textSync(
  config: SmolConfig,
): Promise<Result<PromptResult>> {
  if (config.provider === "llama-cpp" && !hasProvider("llama-cpp")) {
    await loadLlamaCpp();
  }
  config.messages = fixMessagesIfNecessary(config.messages);
  return getClient(config).textSync(config);
}

export async function* textStream(
  config: SmolConfig,
): AsyncGenerator<StreamChunk> {
  if (config.provider === "llama-cpp" && !hasProvider("llama-cpp")) {
    await loadLlamaCpp();
  }
  config.messages = fixMessagesIfNecessary(config.messages);
  yield* getClient(config).textStream(config);
}
