import OpenAI from "openai";
import { OpenAITranscriptionClient } from "./openai.js";

/**
 * Groq exposes an OpenAI-compatible /audio/transcriptions endpoint (Whisper
 * large-v3 / large-v3-turbo). Everything but the base URL is inherited.
 */
export class GroqTranscriptionClient extends OpenAITranscriptionClient {
  protected override makeClient(): OpenAI {
    return new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: "https://api.groq.com/openai/v1",
    });
  }

  protected override noKeyMessage(): string {
    return "No Groq API key provided. Set apiKey.groq or GROQ_API_KEY.";
  }
}
