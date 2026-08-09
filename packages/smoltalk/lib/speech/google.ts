import { GoogleGenAI } from "@google/genai";
import { Result, success, failure } from "../types/result.js";
import { pcmToWav } from "../util/audioMime.js";
import { normalizeGoogleAudioUsage } from "../googleAudioUsage.js";
import { BaseSpeechClient } from "./baseSpeechClient.js";
import type { SpeechResult, PcmAudioMetadata } from "../speech.js";

const GEMINI_PCM: PcmAudioMetadata = { sampleRateHz: 24000, sampleFormat: "s16le", channels: 1 };

export class GoogleSpeechClient extends BaseSpeechClient {
  // No try/catch: BaseSpeechClient.speak() is the exception boundary.
  protected async _speak(text: string): Promise<Result<SpeechResult>> {
    if (!this.config.apiKey) {
      return failure("No Google API key provided. Set apiKey.google or GEMINI_API_KEY.");
    }
    // Gemini controls pacing via prompt style, not a numeric speed parameter.
    if (this.config.speed !== undefined) {
      return failure(
        "Gemini TTS does not support the 'speed' option; control pacing via the prompt text.",
      );
    }
    const format = this.config.format ?? "pcm";
    if (format !== "pcm" && format !== "wav") {
      return failure(
        `Gemini TTS only produces raw PCM. Supported formats: pcm (default), wav. Got "${format}".`,
      );
    }

    const ai = new GoogleGenAI({ apiKey: this.config.apiKey });
    const res = await ai.models.generateContent({
      model: this.config.model,
      contents: [{ role: "user", parts: [{ text }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: this.config.voice } },
        },
      },
    });

    const dataB64 = res.candidates?.[0]?.content?.parts?.find(
      (part) => part.inlineData?.data !== undefined,
    )?.inlineData?.data;
    if (!dataB64) {
      return failure("Gemini returned no audio data.");
    }
    const pcm = new Uint8Array(Buffer.from(dataB64, "base64"));

    let audio: Uint8Array = pcm;
    let mimeType = "application/octet-stream";
    if (format === "wav") {
      audio = pcmToWav(pcm, { sampleRateHz: 24000, channels: 1, bitsPerSample: 16 });
      mimeType = "audio/wav";
    }

    const usage = normalizeGoogleAudioUsage(res.usageMetadata, "output");

    const result: SpeechResult = { audio, mimeType, raw: res };
    if (format === "pcm") result.pcm = GEMINI_PCM;
    if (usage) result.usage = usage;
    return success(result);
  }
}
