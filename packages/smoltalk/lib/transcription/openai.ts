import OpenAI, { toFile } from "openai";
import { Result, success, failure } from "../types/result.js";
import { getModelForProvider, isSpeechToTextModel } from "../models.js";
import { round } from "../util/util.js";
import { transcriptionAudioType } from "../util/audioMime.js";
import type {
  TranscriptionProviderContext,
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

export async function openaiTranscribe(
  data: Uint8Array,
  mimeType: string,
  ctx: TranscriptionProviderContext,
): Promise<Result<TranscriptionResult>> {
  const { opts } = ctx;
  // Deliberately do not catch SDK exceptions here: transcribe() is the single
  // redacting/logging exception boundary.
  const model = getModelForProvider("openai", opts.model, opts.modelData);
  if (model && !isSpeechToTextModel(model)) {
    return failure(`Model "${opts.model}" is not a speech-to-text model.`);
  }

  const audioType = transcriptionAudioType(mimeType);
  if (audioType === null) {
    return failure(
      `Unsupported audio type "${mimeType}" for transcription. Supported: flac, mp3, mp4, m4a, ogg, wav, webm.`,
    );
  }

  const client = new OpenAI({ apiKey: ctx.apiKey });
  const filename = opts.filename ?? audioType.filename;
  const file = await toFile(data, filename, { type: mimeType });

  const granularities: ("segment" | "word")[] = [];
  if (opts.timestampGranularity) {
    granularities.push(opts.timestampGranularity);
  }

  const requestBody: Record<string, unknown> = {
    file,
    model: opts.model,
    response_format: "verbose_json",
  };
  if (opts.language) {
    requestBody.language = opts.language;
  }
  if (opts.prompt) {
    requestBody.prompt = opts.prompt;
  }
  if (granularities.length > 0) {
    requestBody.timestamp_granularities = granularities;
  }

  const res = (await client.audio.transcriptions.create(
    requestBody as unknown as Parameters<typeof client.audio.transcriptions.create>[0],
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

  if (model && isSpeechToTextModel(model) && model.perMinuteCost !== undefined && result.durationSeconds != null) {
    const inputCost = round((result.durationSeconds / 60) * model.perMinuteCost, 6);
    result.cost = { inputCost, outputCost: 0, totalCost: inputCost, currency: "USD" };
  }
  return success(result);
}
