import OpenAI from "openai";
import { OpenAISpeechClient } from "./openai.js";
import type { SpeakFormat } from "../util/audioMime.js";

/**
 * Groq exposes OpenAI-compatible Orpheus TTS and supports WAV only.
 */
export class GroqSpeechClient extends OpenAISpeechClient {
  protected override makeClient(): OpenAI {
    return new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: "https://api.groq.com/openai/v1",
    });
  }

  protected override defaultFormat(): SpeakFormat {
    return "wav";
  }

  protected override noKeyMessage(): string {
    return "No Groq API key provided. Set apiKey.groq or GROQ_API_KEY.";
  }
}
