import type { ModelDataBlob } from "./modelData.js";
import type { SmolConfig } from "./types.js";
import { Result, success, failure } from "./types/result.js";
import { CostEstimate } from "./types/costEstimate.js";
import { redactSecret } from "./util/redact.js";
import { getLogger } from "./util/logger.js";
import { resolveProvider, resolveApiKey } from "./util/provider.js";
import {
  BaseSpeechClient,
  SpeechClientConfig,
} from "./speech/baseSpeechClient.js";
import { OpenAISpeechClient } from "./speech/openai.js";
import { GroqSpeechClient } from "./speech/groq.js";

export type SpeakOptions = {
  model: string;
  voice: string;
  provider?: string;
  modelData?: ModelDataBlob;
  apiKey?: SmolConfig["apiKey"];
  format?: string;
  speed?: number;
  metadata?: Record<string, unknown>;
};

export type PcmAudioMetadata = {
  sampleRateHz: number;
  /** Sample representation, e.g. "s16le"; provider-specific. */
  sampleFormat: string;
  channels: number;
};

export type SpeechResult = {
  audio: Uint8Array;
  mimeType: string;
  pcm?: PcmAudioMetadata;
  cost?: CostEstimate;
  raw?: unknown;
};

export type SpeechClientClass = new (config: SpeechClientConfig) => BaseSpeechClient;

// Checked before the user registry so a registered "openai" can't hijack the built-in.
const builtinClients: Record<string, SpeechClientClass> = Object.create(null);
builtinClients["openai"] = OpenAISpeechClient;
builtinClients["groq"] = GroqSpeechClient;

// Null-prototype so provider names like "toString"/"__proto__" can't collide
// with Object.prototype or pollute the registry.
const registered: Record<string, SpeechClientClass> = Object.create(null);

export function registerSpeechProvider(name: string, cls: SpeechClientClass): void {
  registered[name] = cls;
}

/** Test-only: clear all registered custom providers so registrations don't leak across tests. */
export function _resetForTests(): void {
  for (const key of Object.keys(registered)) {
    delete registered[key];
  }
}

/**
 * Resolve provider + API key and instantiate the matching speech client for
 * the declarative speak() operation. Never throws: a custom client class's
 * constructor can throw, and this internal factory's catch redacts the
 * resolved key so a constructor error cannot leak through the public wrapper.
 */
export function getSpeechClient(opts: SpeakOptions): Result<BaseSpeechClient> {
  let apiKeyForRedaction = "";
  try {
    const provider = resolveProvider(opts.model, opts.provider, opts.modelData);

    const ClientClass = builtinClients[provider] ?? registered[provider];
    if (ClientClass === undefined) {
      return failure(
        `Provider "${provider}" has no speech API. Register one with registerSpeechProvider(name, ClientClass).`,
      );
    }

    const apiKey = resolveApiKey(provider, opts) ?? "";
    apiKeyForRedaction = apiKey;
    const { apiKey: _callerKeys, ...clientOpts } = opts;
    const config: SpeechClientConfig = { ...clientOpts, provider, apiKey };
    return success(new ClientClass(config));
  } catch (err) {
    let msg = "getSpeechClient() failed";
    if (err instanceof Error) {
      msg = err.message;
    }
    const redacted = redactSecret(msg, apiKeyForRedaction);
    getLogger().error("getSpeechClient() failed:", redacted);
    return failure(redacted);
  }
}

export async function speak(text: string, opts: SpeakOptions): Promise<Result<SpeechResult>> {
  const client = getSpeechClient(opts);
  if (!client.success) {
    return client;
  }
  return client.value.speak(text);
}
