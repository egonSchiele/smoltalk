import {
  BaseMessage,
  Message,
  messageFromJSON,
} from "./classes/message/index.js";
import { getClient } from "./client.js";
import {
  PromptResult,
  SmolConfig,
  StreamChunk,
} from "./types.js";
import { Result } from "./types/result.js";
import { getLogger } from "./util/logger.js";
import type { z, ZodType } from "zod";

function fixMessagesIfNecessary(messages: any[]): Message[] {
  if (messages && messages.length > 0) {
    if (!(messages[0] instanceof BaseMessage)) {
      getLogger().warn("Messages are not instances of smoltalk.BaseMessage");
      return messages.map((m) => messageFromJSON(m));
    }
  }
  return messages;
}

// Streaming: stays string-typed. The done chunk's result is the raw model
// output, not the validated parsed object (streaming bypasses textWithRetry).
export function text(
  config: SmolConfig & { stream: true },
): AsyncGenerator<StreamChunk>;
// Sync + responseFormat: infer the parsed-output type from the Zod schema.
export function text<S extends ZodType>(
  config: Omit<SmolConfig, "responseFormat"> & {
    responseFormat: S;
    stream?: false;
  },
): Promise<Result<PromptResult<z.infer<S>>>>;
// Default sync: string-typed output.
export function text(
  config: SmolConfig & { stream?: false },
): Promise<Result<PromptResult>>;
export function text(
  config: SmolConfig,
): Promise<Result<PromptResult<any>>> | AsyncGenerator<StreamChunk> {
  if (config.stream) return textStream(config);
  return textSync(config);
}

export function textSync<S extends ZodType>(
  config: Omit<SmolConfig, "responseFormat"> & { responseFormat: S },
): Promise<Result<PromptResult<z.infer<S>>>>;
export function textSync(
  config: SmolConfig,
): Promise<Result<PromptResult>>;
export async function textSync(
  config: SmolConfig,
): Promise<Result<PromptResult<any>>> {
  config.messages = fixMessagesIfNecessary(config.messages);
  return getClient(config).textSync(config) as Promise<
    Result<PromptResult<any>>
  >;
}

export async function* textStream(
  config: SmolConfig,
): AsyncGenerator<StreamChunk> {
  config.messages = fixMessagesIfNecessary(config.messages);
  yield* getClient(config).textStream(config);
}
