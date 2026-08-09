import { GoogleGenAI } from "@google/genai";
import { Result, success, failure } from "../types/result.js";
import { BaseTranscriptionClient } from "./baseTranscriptionClient.js";
import type { TranscriptionResult } from "../transcription.js";
import { normalizeGoogleAudioUsage } from "../util/googleAudioUsage.js";
import { googleAudioWireMime } from "../util/audioMime.js";

// Gemini's inline request cap is 20 MB for the *entire* request (audio bytes,
// base64 expansion, prompt, and SDK envelope), not the raw file alone.
const GOOGLE_INLINE_REQUEST_MAX_BYTES = 20_000_000;

export class GoogleTranscriptionClient extends BaseTranscriptionClient {
  // No try/catch: BaseTranscriptionClient.transcribe() is the exception boundary.
  protected async _transcribe(
    data: Uint8Array,
    mimeType: string,
  ): Promise<Result<TranscriptionResult>> {
    if (!this.config.apiKey) {
      return failure("No Google API key provided. Set apiKey.google or GEMINI_API_KEY.");
    }
    if (this.config.timestampGranularity !== undefined) {
      return failure("Gemini transcription does not support timestampGranularity.");
    }

    let instruction =
      "Transcribe the following audio verbatim. Output only the transcript text, with no commentary.";
    if (this.config.language) {
      instruction += ` The audio is in ${this.config.language}.`;
    }
    if (this.config.prompt) {
      instruction += ` ${this.config.prompt}`;
    }

    const base64 = Buffer.from(data).toString("base64");
    const request = {
      model: this.config.model,
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType: googleAudioWireMime(mimeType), data: base64 } },
          { text: instruction },
        ],
      }],
    };
    if (Buffer.byteLength(JSON.stringify(request), "utf8") > GOOGLE_INLINE_REQUEST_MAX_BYTES) {
      return failure(
        "Audio and instructions exceed Gemini's 20 MB inline request limit; use a smaller source.",
      );
    }

    const ai = new GoogleGenAI({ apiKey: this.config.apiKey });
    // Signal is passed at call time (not part of `request`) so the encoded-size
    // check above measures only the payload. Gemini's abortSignal is client-only:
    // it tears down the request but does not stop server-side billing.
    const res = await ai.models.generateContent({
      ...request,
      config: { abortSignal: this.config.abortSignal },
    });
    const usage = normalizeGoogleAudioUsage(res.usageMetadata, "input");

    const result: TranscriptionResult = {
      text: res.text ?? "",
      raw: res,
    };
    if (usage) result.usage = usage;
    return success(result);
  }
}
