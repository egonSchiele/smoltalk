import type { ModelDataBlob } from "./modelData.js";
import type { SmolConfig } from "./types.js";
import { Result, failure } from "./types/result.js";
import { CostEstimate } from "./types/costEstimate.js";
import { resolveProvider, resolveApiKey } from "./util/provider.js";
import { redactSecret } from "./util/redact.js";
import { getLogger } from "./util/logger.js";
import { SpeakFormat } from "./util/audioMime.js";
import { openaiSpeak } from "./speech/openai.js";

export type SpeakOptions = {
  model: string;
  voice: string;
  provider?: string;
  modelData?: ModelDataBlob;
  apiKey?: SmolConfig["apiKey"];
  format?: SpeakFormat;
  speed?: number;
};

export type PcmAudioMetadata = {
  sampleRateHz: 24000;
  sampleFormat: "s16le";
  channels: 1;
};

export type SpeechResult = {
  audio: Uint8Array;
  mimeType: string;
  pcm?: PcmAudioMetadata;
  cost?: CostEstimate;
  raw?: unknown;
};

/** Provider-facing options: same as {@link SpeakOptions} minus the caller's `apiKey`. */
export type SpeechProviderOptions = Omit<SpeakOptions, "apiKey">;

/**
 * Carries the resolved key plus provider options with the caller's `apiKey`
 * stripped, so a plugin gets a single secret source rather than two.
 */
export type SpeechProviderContext = {
  apiKey: string;
  opts: SpeechProviderOptions;
};

export type SpeechProvider = {
  speak(text: string, ctx: SpeechProviderContext): Promise<Result<SpeechResult>>;
};

export const OPENAI_SPEECH_MODELS = new Set(["tts-1", "tts-1-hd"]);
export const MAX_TTS_CHARS = 4096;
export const MIN_OPENAI_TTS_SPEED = 0.25;
export const MAX_OPENAI_TTS_SPEED = 4;

// Null-prototype so provider names like "toString"/"__proto__" can't collide
// with Object.prototype or pollute the registry.
const registered: Record<string, SpeechProvider> = Object.create(null);

export function registerSpeechProvider(name: string, impl: SpeechProvider): void {
  registered[name] = impl;
}

/** Test-only: clear all registered custom providers so registrations don't leak across tests. */
export function _resetForTests(): void {
  for (const key of Object.keys(registered)) {
    delete registered[key];
  }
}

function providerContext(apiKey: string, opts: SpeakOptions): SpeechProviderContext {
  const { apiKey: _callerKey, ...providerOptions } = opts;
  return { apiKey, opts: providerOptions };
}

export async function speak(text: string, opts: SpeakOptions): Promise<Result<SpeechResult>> {
  // Populated once the dispatch provider is known, so the catch below redacts
  // whichever provider's key actually got sent, not a guess made before
  // resolveProvider() ran.
  let apiKeyForRedaction = "";
  try {
    let provider: string;
    try {
      provider = resolveProvider(opts.model, opts.provider, opts.modelData);
    } catch (err) {
      return failure(err instanceof Error ? err.message : "Failed to resolve provider");
    }
    apiKeyForRedaction = resolveApiKey(provider, opts) ?? "";

    if (provider === "openai") {
      if ([...text].length > MAX_TTS_CHARS) {
        return failure(`Input exceeds the ${MAX_TTS_CHARS}-character OpenAI TTS limit.`);
      }
      if (
        opts.speed !== undefined &&
        (!Number.isFinite(opts.speed) ||
          opts.speed < MIN_OPENAI_TTS_SPEED ||
          opts.speed > MAX_OPENAI_TTS_SPEED)
      ) {
        return failure(
          `speed must be a finite number in [${MIN_OPENAI_TTS_SPEED}, ${MAX_OPENAI_TTS_SPEED}].`,
        );
      }
      if (!OPENAI_SPEECH_MODELS.has(opts.model)) {
        return failure(
          `Model "${opts.model}" is not a supported OpenAI speech model in v1 (supported: ${[...OPENAI_SPEECH_MODELS].join(", ")}).`,
        );
      }
      const apiKey = resolveApiKey("openai", opts);
      if (!apiKey) {
        return failure("No OpenAI API key provided. Set apiKey.openAi or OPENAI_API_KEY.");
      }
      return await openaiSpeak(text, providerContext(apiKey, opts));
    }

    const custom = registered[provider];
    if (custom) {
      const apiKey = resolveApiKey(provider, opts) ?? "";
      return await custom.speak(text, providerContext(apiKey, opts));
    }
    return failure(
      `Provider "${provider}" has no speech API. Register one with registerSpeechProvider(name, impl).`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "speak() failed";
    const redacted = redactSecret(msg, apiKeyForRedaction);
    getLogger().error("speak() provider failed:", redacted);
    return failure(redacted);
  }
}
