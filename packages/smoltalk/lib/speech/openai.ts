import OpenAI from "openai";
import type { SpeechCreateParams } from "openai/resources/audio/speech";
import { Result, success, failure } from "../types/result.js";
import {
  SPEECH_FORMAT_TO_MIME,
  isSpeakFormat,
  type SpeakFormat,
} from "../util/audioMime.js";
import { BaseSpeechClient } from "./baseSpeechClient.js";
import type { SpeechResult } from "../speech.js";

export class OpenAISpeechClient extends BaseSpeechClient {
  /** Build the OpenAI SDK client. Subclasses override to point at a compatible base URL. */
  protected makeClient(): OpenAI {
    return new OpenAI({ apiKey: this.config.apiKey });
  }

  /** Provider default used when the declarative call omits format. */
  protected defaultFormat(): SpeakFormat {
    return "mp3";
  }

  // No try/catch here: BaseSpeechClient.speak() is the single
  // redacting/logging exception boundary.
  protected async _speak(text: string): Promise<Result<SpeechResult>> {
    if (!this.config.apiKey) {
      return failure("No OpenAI API key provided. Set apiKey.openAi or OPENAI_API_KEY.");
    }

    // The shared contract carries format as a plain string; narrow to OpenAI's
    // closed union at runtime before indexing the MIME table.
    const requestedFormat = this.config.format ?? this.defaultFormat();
    if (!isSpeakFormat(requestedFormat)) {
      return failure(
        `Format "${requestedFormat}" is not a supported OpenAI speech format. ` +
          `Supported: ${Object.keys(SPEECH_FORMAT_TO_MIME).join(", ")}.`,
      );
    }
    const format: SpeakFormat = requestedFormat;
    const mimeType = SPEECH_FORMAT_TO_MIME[format];

    const client = this.makeClient();
    const params: SpeechCreateParams = {
      model: this.config.model,
      voice: this.config.voice as SpeechCreateParams["voice"],
      input: text,
      response_format: format,
    };
    if (this.config.speed !== undefined) {
      params.speed = this.config.speed;
    }
    const res = await client.audio.speech.create(params);
    const audio = new Uint8Array(await res.arrayBuffer());

    const result: SpeechResult = { audio, mimeType };
    if (format === "pcm") {
      result.pcm = { sampleRateHz: 24000, sampleFormat: "s16le", channels: 1 };
    }
    return success(result);
  }
}
