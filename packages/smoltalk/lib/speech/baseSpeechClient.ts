import type { ModelDataBlob } from "../modelData.js";
import {
  getModelForProvider,
  isTextToSpeechModel,
  type TextToSpeechModel,
} from "../models.js";
import { calculateSpeechCost } from "../model.js";
import { Result, failure } from "../types/result.js";
import { redactSecret } from "../util/redact.js";
import { getLogger } from "../util/logger.js";
import type { SpeechResult } from "../speech.js";

export type SpeechClientConfig = {
  model: string;
  /** Resolved provider name. */
  provider: string;
  /** Resolved API key; empty string when none was found. */
  apiKey: string;
  voice: string;
  modelData?: ModelDataBlob;
  /** Output format; provider-specific vocabulary (OpenAI: mp3/opus/aac/flac/wav/pcm). */
  format?: string;
  speed?: number;
  metadata?: Record<string, unknown>;
};

/** Validate the declarative TTS constraint block once before consuming it. */
function speechConstraintError(model: TextToSpeechModel): string | null {
  const maxInputChars: unknown = model.maxInputChars;
  if (
    maxInputChars !== undefined &&
    (typeof maxInputChars !== "number" ||
      !Number.isInteger(maxInputChars) ||
      maxInputChars <= 0)
  ) {
    return `Model "${model.modelName}" has an invalid maxInputChars value.`;
  }

  const speedRange: unknown = model.speedRange;
  if (speedRange !== undefined) {
    if (typeof speedRange !== "object" || speedRange === null) {
      return `Model "${model.modelName}" has an invalid speedRange.`;
    }
    const min: unknown = (speedRange as { min?: unknown }).min;
    const max: unknown = (speedRange as { max?: unknown }).max;
    if (
      typeof min !== "number" ||
      typeof max !== "number" ||
      !Number.isFinite(min) ||
      !Number.isFinite(max) ||
      min > max
    ) {
      return `Model "${model.modelName}" has an invalid speedRange.`;
    }
  }

  const formats: unknown = model.formats;
  if (
    formats !== undefined &&
    (!Array.isArray(formats) ||
      !formats.every((format): format is string => typeof format === "string"))
  ) {
    return `Model "${model.modelName}" has invalid formats.`;
  }
  return null;
}

/**
 * Shared TTS behavior, mirroring BaseClient for text generation: the public
 * speak() template method owns model-data-driven validation (char cap, speed
 * range, format list), cost, and the single redacting/logging exception
 * boundary. Subclasses implement only _speak(): SDK call + response mapping.
 * A model with no registry entry skips validation — the provider is then the
 * authority, matching how cost is silently omitted for unknown models.
 */
export abstract class BaseSpeechClient {
  protected config: SpeechClientConfig;

  constructor(config: SpeechClientConfig) {
    this.config = config;
  }

  async speak(text: string): Promise<Result<SpeechResult>> {
    try {
      const model = getModelForProvider(this.config.provider, this.config.model, this.config.modelData);
      if (model !== undefined && !isTextToSpeechModel(model)) {
        return failure(`Model "${this.config.model}" is not a text-to-speech model.`);
      }

      if (model !== undefined) {
        const constraintError = speechConstraintError(model);
        if (constraintError !== null) {
          return failure(constraintError);
        }
        if (model.maxInputChars !== undefined && [...text].length > model.maxInputChars) {
          return failure(
            `Input exceeds the ${model.maxInputChars}-character limit for model "${this.config.model}".`,
          );
        }
        if (this.config.speed !== undefined && model.speedRange !== undefined) {
          const { min, max } = model.speedRange;
          if (!Number.isFinite(this.config.speed) || this.config.speed < min || this.config.speed > max) {
            return failure(`speed must be a finite number in [${min}, ${max}].`);
          }
        }
        if (
          this.config.format !== undefined &&
          model.formats !== undefined &&
          !model.formats.includes(this.config.format)
        ) {
          return failure(
            `Format "${this.config.format}" is not supported by model "${this.config.model}". ` +
              `Supported: ${model.formats.join(", ")}.`,
          );
        }
      }

      const result = await this._speak(text);
      if (!result.success) {
        return result;
      }
      const cost = calculateSpeechCost(model, [...text].length);
      if (cost !== undefined) {
        result.value.cost = cost;
      }
      return result;
    } catch (err) {
      let msg = "speak() failed";
      if (err instanceof Error) {
        msg = err.message;
      }
      const redacted = redactSecret(msg, this.config.apiKey);
      getLogger().error("speak() provider failed:", redacted);
      return failure(redacted);
    }
  }

  /** Provider hook: SDK call + response mapping only; validation and cost live in the base. */
  protected abstract _speak(text: string): Promise<Result<SpeechResult>>;
}
