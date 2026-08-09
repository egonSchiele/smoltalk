import OpenAI from "openai";
import type { SpeechCreateParams } from "openai/resources/audio/speech";
import { Result, success, failure } from "../types/result.js";
import { getModelForProvider, isTextToSpeechModel } from "../models.js";
import { round } from "../util/util.js";
import { SPEECH_FORMAT_TO_MIME, SpeakFormat } from "../util/audioMime.js";
import type { SpeechProviderContext, SpeechResult } from "../speech.js";

export async function openaiSpeak(
  text: string,
  ctx: SpeechProviderContext,
): Promise<Result<SpeechResult>> {
  const { opts } = ctx;
  // Deliberately do not catch SDK exceptions here: speak() is the single
  // redacting/logging exception boundary.
  const format: SpeakFormat = opts.format ?? "mp3";
  const mimeType = SPEECH_FORMAT_TO_MIME[format];
  if (!mimeType) {
    return failure(`Unknown speech format "${format}".`);
  }

  const client = new OpenAI({ apiKey: ctx.apiKey });
  const res = await client.audio.speech.create({
    model: opts.model,
    voice: opts.voice as SpeechCreateParams["voice"],
    input: text,
    response_format: format,
    ...(opts.speed !== undefined ? { speed: opts.speed } : {}),
  });
  const audio = new Uint8Array(await res.arrayBuffer());

  const result: SpeechResult = { audio, mimeType };
  if (format === "pcm") {
    result.pcm = { sampleRateHz: 24000, sampleFormat: "s16le", channels: 1 };
  }

  const model = getModelForProvider("openai", opts.model, opts.modelData);
  if (model && isTextToSpeechModel(model) && model.perCharacterCost !== undefined) {
    const inputCost = round([...text].length * model.perCharacterCost, 6);
    result.cost = { inputCost, outputCost: 0, totalCost: inputCost, currency: "USD" };
  }
  return success(result);
}
