import type { ModelDataBlob } from "./modelData.js";
import type { SmolConfig } from "./types.js";
import { Result, success, failure } from "./types/result.js";
import { TokenUsage } from "./types/tokenUsage.js";
import { CostEstimate } from "./types/costEstimate.js";
import { BlobRef } from "./util/blobRef.js";
import { redactSecret } from "./util/redact.js";
import { getLogger } from "./util/logger.js";
import { resolveProvider, resolveApiKey } from "./util/provider.js";
import {
  BaseTranscriptionClient,
  TranscriptionClientConfig,
} from "./transcription/baseTranscriptionClient.js";
import { OpenAITranscriptionClient } from "./transcription/openai.js";

export { DEFAULT_TRANSCRIBE_BYTES } from "./transcription/baseTranscriptionClient.js";

export type TranscribeOptions = {
  model: string;
  provider?: string;
  modelData?: ModelDataBlob;
  apiKey?: SmolConfig["apiKey"];
  language?: string;
  prompt?: string;
  timestampGranularity?: "segment" | "word";
  maxBytes?: number;
  metadata?: Record<string, unknown>;
};

export type TranscriptionSegment = { start: number; end: number; text: string };
export type TranscriptionWord = { start: number; end: number; word: string };

export type TranscriptionResult = {
  text: string;
  language?: string;
  durationSeconds?: number;
  segments?: TranscriptionSegment[];
  words?: TranscriptionWord[];
  usage?: TokenUsage;
  cost?: CostEstimate;
  raw?: unknown;
};

export type TranscriptionClientClass = new (
  config: TranscriptionClientConfig,
) => BaseTranscriptionClient;

// Checked before the user registry so a registered "openai" can't hijack the built-in.
const builtinClients: Record<string, TranscriptionClientClass> = Object.create(null);
builtinClients["openai"] = OpenAITranscriptionClient;

// Null-prototype so provider names like "toString"/"__proto__" can't collide
// with Object.prototype or pollute the registry.
const registered: Record<string, TranscriptionClientClass> = Object.create(null);

export function registerTranscriptionProvider(
  name: string,
  cls: TranscriptionClientClass,
): void {
  registered[name] = cls;
}

/** Test-only: clear all registered custom providers so registrations don't leak across tests. */
export function _resetForTests(): void {
  for (const key of Object.keys(registered)) {
    delete registered[key];
  }
}

/**
 * Resolve provider + API key and instantiate the matching transcription client
 * for the declarative transcribe() operation. Never throws: a custom client
 * class's constructor can throw, and this internal factory's catch redacts the
 * resolved key so a constructor error cannot leak through the public wrapper.
 */
export function getTranscriptionClient(
  opts: TranscribeOptions,
): Result<BaseTranscriptionClient> {
  let apiKeyForRedaction = "";
  try {
    const provider = resolveProvider(opts.model, opts.provider, opts.modelData);

    const ClientClass = builtinClients[provider] ?? registered[provider];
    if (ClientClass === undefined) {
      return failure(
        `Provider "${provider}" has no transcription API. Register one with registerTranscriptionProvider(name, ClientClass).`,
      );
    }

    const apiKey = resolveApiKey(provider, opts) ?? "";
    apiKeyForRedaction = apiKey;
    const { apiKey: _callerKeys, ...clientOpts } = opts;
    const config: TranscriptionClientConfig = { ...clientOpts, provider, apiKey };
    return success(new ClientClass(config));
  } catch (err) {
    let msg = "getTranscriptionClient() failed";
    if (err instanceof Error) {
      msg = err.message;
    }
    const redacted = redactSecret(msg, apiKeyForRedaction);
    getLogger().error("getTranscriptionClient() failed:", redacted);
    return failure(redacted);
  }
}

export async function transcribe(
  source: BlobRef,
  opts: TranscribeOptions,
): Promise<Result<TranscriptionResult>> {
  const client = getTranscriptionClient(opts);
  if (!client.success) {
    return client;
  }
  return client.value.transcribe(source);
}
