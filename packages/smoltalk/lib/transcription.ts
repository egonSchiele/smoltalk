import type { ModelDataBlob } from "./modelData.js";
import type { SmolConfig } from "./types.js";
import { Result, failure } from "./types/result.js";
import { TokenUsage } from "./types/tokenUsage.js";
import { CostEstimate } from "./types/costEstimate.js";
import { BlobRef, loadBlob } from "./util/imageRef.js";
import { resolveProvider, resolveApiKey } from "./util/provider.js";
import { redactSecret } from "./util/redact.js";
import { getLogger } from "./util/logger.js";
import { openaiTranscribe } from "./transcription/openai.js";

export type TranscribeOptions = {
  model: string;
  provider?: string;
  modelData?: ModelDataBlob;
  apiKey?: SmolConfig["apiKey"];
  language?: string;
  prompt?: string;
  timestampGranularity?: "segment" | "word";
  maxBytes?: number;
  filename?: string;
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

/** Provider-facing options: same as {@link TranscribeOptions} minus the caller's `apiKey`. */
export type TranscriptionProviderOptions = Omit<TranscribeOptions, "apiKey">;

/**
 * Carries the resolved key plus provider options with the caller's `apiKey`
 * stripped, so a plugin gets a single secret source rather than two.
 */
export type TranscriptionProviderContext = {
  apiKey: string;
  opts: TranscriptionProviderOptions;
};

export type TranscriptionProvider = {
  transcribe(
    data: Uint8Array,
    mimeType: string,
    ctx: TranscriptionProviderContext,
  ): Promise<Result<TranscriptionResult>>;
};

export const OPENAI_TRANSCRIBE_MODELS = new Set(["whisper-1"]);
export const DEFAULT_TRANSCRIBE_BYTES = 25 * 1024 * 1024;

// Null-prototype so provider names like "toString"/"__proto__" can't collide
// with Object.prototype or pollute the registry.
const registered: Record<string, TranscriptionProvider> = Object.create(null);

export function registerTranscriptionProvider(name: string, impl: TranscriptionProvider): void {
  registered[name] = impl;
}

/** Test-only: clear all registered custom providers so registrations don't leak across tests. */
export function _resetForTests(): void {
  for (const key of Object.keys(registered)) {
    delete registered[key];
  }
}

function providerContext(apiKey: string, opts: TranscribeOptions): TranscriptionProviderContext {
  const { apiKey: _callerKey, ...providerOptions } = opts;
  return { apiKey, opts: providerOptions };
}

export async function transcribe(
  source: BlobRef,
  opts: TranscribeOptions,
): Promise<Result<TranscriptionResult>> {
  const apiKeyForRedaction = resolveApiKey(opts.provider ?? "openai", opts) ?? "";
  try {
    let provider: string;
    try {
      provider = resolveProvider(opts.model, opts.provider, opts.modelData);
    } catch (err) {
      return failure(err instanceof Error ? err.message : "Failed to resolve provider");
    }

    const maxBytes = opts.maxBytes ?? DEFAULT_TRANSCRIBE_BYTES;
    let loaded: { data: Uint8Array; mimeType?: string };
    try {
      loaded = await loadBlob(source, { maxBytes });
    } catch (err) {
      return failure(`Failed to load audio for transcription: ${(err as Error).message}`);
    }
    const mimeType = loaded.mimeType ?? "application/octet-stream";

    if (provider === "openai") {
      if (!OPENAI_TRANSCRIBE_MODELS.has(opts.model)) {
        return failure(
          `Model "${opts.model}" is not a supported OpenAI transcription model in v1 (supported: ${[...OPENAI_TRANSCRIBE_MODELS].join(", ")}).`,
        );
      }
      const apiKey = resolveApiKey("openai", opts);
      if (!apiKey) {
        return failure("No OpenAI API key provided. Set apiKey.openAi or OPENAI_API_KEY.");
      }
      return await openaiTranscribe(loaded.data, mimeType, providerContext(apiKey, opts));
    }

    const custom = registered[provider];
    if (custom) {
      const apiKey = resolveApiKey(provider, opts) ?? "";
      return await custom.transcribe(loaded.data, mimeType, providerContext(apiKey, opts));
    }
    return failure(
      `Provider "${provider}" has no transcription API. Register one with registerTranscriptionProvider(name, impl).`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "transcribe() failed";
    const redacted = redactSecret(msg, apiKeyForRedaction);
    getLogger().error("transcribe() provider failed:", redacted);
    return failure(redacted);
  }
}
