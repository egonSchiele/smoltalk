import type { ModelDataBlob } from "../modelData.js";
import {
  getModelForProvider,
  isSpeechToTextModel,
  type SpeechToTextModel,
} from "../models.js";
import { calculateTranscriptionCost } from "../model.js";
import { Result, success, failure } from "../types/result.js";
import { BlobRef, loadBlob } from "../util/blobRef.js";
import { audioFormatForMime, canonicalizeMime } from "../util/mime.js";
import { redactSecret } from "../util/redact.js";
import { getLogger } from "../util/logger.js";
import type { TranscriptionResult } from "../transcription.js";

export const DEFAULT_TRANSCRIBE_BYTES = 25 * 1024 * 1024;

export type TranscriptionClientConfig = {
  model: string;
  /** Resolved provider name. */
  provider: string;
  /** Resolved API key; empty string when none was found. */
  apiKey: string;
  modelData?: ModelDataBlob;
  language?: string;
  prompt?: string;
  timestampGranularity?: "segment" | "word";
  maxBytes?: number;
  metadata?: Record<string, unknown>;
};

/** Validate the declarative STT constraint block once before consuming it. */
function transcriptionConstraintError(model: SpeechToTextModel): string | null {
  const modelMaxBytes: unknown = model.maxBytes;
  if (
    modelMaxBytes !== undefined &&
    (typeof modelMaxBytes !== "number" || !Number.isFinite(modelMaxBytes) || modelMaxBytes <= 0)
  ) {
    return `Model "${model.modelName}" has an invalid maxBytes value.`;
  }
  const supportedMimeTypes: unknown = model.supportedMimeTypes;
  if (
    supportedMimeTypes !== undefined &&
    (!Array.isArray(supportedMimeTypes) ||
      !supportedMimeTypes.every((mime): mime is string => typeof mime === "string"))
  ) {
    return `Model "${model.modelName}" has invalid supportedMimeTypes.`;
  }
  return null;
}

// The caller's maxBytes is a safety limit; the model's maxBytes is the
// provider's hard cap. Take the smaller of whichever are present so a caller
// can tighten the limit but never bypass the provider cap.
function resolveTranscriptionMaxBytes(
  callerMaxBytes: number | undefined,
  model: SpeechToTextModel | undefined,
): Result<number> {
  if (
    callerMaxBytes !== undefined &&
    (!Number.isFinite(callerMaxBytes) || callerMaxBytes <= 0)
  ) {
    return failure(`maxBytes must be a positive finite number (got ${callerMaxBytes}).`);
  }
  const limits: number[] = [];
  if (callerMaxBytes !== undefined) {
    limits.push(callerMaxBytes);
  }
  if (model?.maxBytes !== undefined) {
    limits.push(model.maxBytes);
  }
  if (limits.length === 0) {
    return success(DEFAULT_TRANSCRIBE_BYTES);
  }
  return success(Math.min(...limits));
}

/**
 * Shared transcription behavior, mirroring BaseClient for text generation:
 * the public transcribe() template method owns blob loading, model-data-driven
 * validation, cost, and the single redacting/logging exception boundary.
 * Subclasses implement only _transcribe(): SDK call + response mapping.
 */
export abstract class BaseTranscriptionClient {
  protected config: TranscriptionClientConfig;

  constructor(config: TranscriptionClientConfig) {
    this.config = config;
  }

  async transcribe(source: BlobRef): Promise<Result<TranscriptionResult>> {
    try {
      const model = getModelForProvider(this.config.provider, this.config.model, this.config.modelData);
      if (model !== undefined && !isSpeechToTextModel(model)) {
        return failure(`Model "${this.config.model}" is not a speech-to-text model.`);
      }

      if (model !== undefined) {
        const constraintError = transcriptionConstraintError(model);
        if (constraintError !== null) {
          return failure(constraintError);
        }
      }
      const effectiveLimit = resolveTranscriptionMaxBytes(this.config.maxBytes, model);
      if (!effectiveLimit.success) {
        return effectiveLimit;
      }

      let loaded: { data: Uint8Array; mimeType?: string };
      try {
        loaded = await loadBlob(source, { maxBytes: effectiveLimit.value });
      } catch (err) {
        return failure(`Failed to load audio for transcription: ${(err as Error).message}`);
      }
      const mimeType = loaded.mimeType ?? "application/octet-stream";

      if (model !== undefined && model.supportedMimeTypes !== undefined) {
        const audioFormat = audioFormatForMime(mimeType);
        const normalizedMime = audioFormat?.mimeType ?? canonicalizeMime(mimeType);
        if (!model.supportedMimeTypes.includes(normalizedMime)) {
          return failure(
            `Unsupported audio type "${mimeType}" for model "${this.config.model}". ` +
              `Supported: ${model.supportedMimeTypes.join(", ")}.`,
          );
        }
      }

      const result = await this._transcribe(loaded.data, mimeType);
      if (!result.success) {
        return result;
      }
      const cost = calculateTranscriptionCost(model, result.value.durationSeconds);
      if (cost !== undefined) {
        result.value.cost = cost;
      }
      return result;
    } catch (err) {
      let msg = "transcribe() failed";
      if (err instanceof Error) {
        msg = err.message;
      }
      const redacted = redactSecret(msg, this.config.apiKey);
      getLogger().error("transcribe() provider failed:", redacted);
      return failure(redacted);
    }
  }

  /** Provider hook: SDK call + response mapping only; validation and cost live in the base. */
  protected abstract _transcribe(
    data: Uint8Array,
    mimeType: string,
  ): Promise<Result<TranscriptionResult>>;
}
