import OpenAI, { toFile } from "openai";
import { Result, success, failure } from "../types/result.js";
import { transcriptionAudioType } from "../util/audioMime.js";
import { BaseTranscriptionClient } from "./baseTranscriptionClient.js";
import type {
  TranscriptionResult,
  TranscriptionSegment,
  TranscriptionWord,
} from "../transcription.js";

type OpenAITranscriptionResponse = {
  text: string;
  language?: string;
  duration?: number;
  segments?: TranscriptionSegment[];
  words?: TranscriptionWord[];
};

export class OpenAITranscriptionClient extends BaseTranscriptionClient {
  /** Build the OpenAI SDK client. Subclasses override to point at a compatible base URL. */
  protected makeClient(): OpenAI {
    return new OpenAI({ apiKey: this.config.apiKey });
  }

  /** Provider-specific diagnostic when no API key is resolved. Subclasses override. */
  protected noKeyMessage(): string {
    return "No OpenAI API key provided. Set apiKey.openAi or OPENAI_API_KEY.";
  }

  // No try/catch here: BaseTranscriptionClient.transcribe() is the single
  // redacting/logging exception boundary.
  protected async _transcribe(
    data: Uint8Array,
    mimeType: string,
  ): Promise<Result<TranscriptionResult>> {
    if (!this.config.apiKey) {
      return failure(this.noKeyMessage());
    }

    // Filename is an OpenAI upload detail, not part of the provider-neutral
    // operation contract. Derive the synthetic name from the normalized MIME.
    const filename = transcriptionAudioType(mimeType)?.filename ?? "audio.bin";

    const client = this.makeClient();
    const file = await toFile(data, filename, { type: mimeType });

    const granularities: ("segment" | "word")[] = [];
    if (this.config.timestampGranularity) {
      granularities.push(this.config.timestampGranularity);
    }

    const requestBody: Record<string, unknown> = {
      file,
      model: this.config.model,
      response_format: "verbose_json",
    };
    if (this.config.language) {
      requestBody.language = this.config.language;
    }
    if (this.config.prompt) {
      requestBody.prompt = this.config.prompt;
    }
    if (granularities.length > 0) {
      requestBody.timestamp_granularities = granularities;
    }

    const res = (await client.audio.transcriptions.create(
      requestBody as unknown as Parameters<typeof client.audio.transcriptions.create>[0],
      { signal: this.config.abortSignal },
    )) as unknown as OpenAITranscriptionResponse;

    const result: TranscriptionResult = { text: res.text, raw: res };
    if (res.language) {
      result.language = res.language;
    }
    if (typeof res.duration === "number") {
      result.durationSeconds = res.duration;
    }
    if (Array.isArray(res.segments)) {
      result.segments = res.segments.map((segment) => ({
        start: segment.start,
        end: segment.end,
        text: segment.text,
      }));
    }
    if (Array.isArray(res.words)) {
      result.words = res.words.map((word) => ({
        start: word.start,
        end: word.end,
        word: word.word,
      }));
    }
    return success(result);
  }
}
