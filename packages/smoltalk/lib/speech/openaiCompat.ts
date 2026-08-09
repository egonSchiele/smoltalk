import OpenAI from "openai";
import { OpenAISpeechClient } from "./openai.js";
import { resolveBaseUrl } from "../util/provider.js";

/**
 * Generic OpenAI-compatible speech (TTS) client. Point it at any provider
 * exposing an OpenAI-shaped /audio/speech endpoint via
 * `config.baseUrl.openAiCompat` (or OPENAI_COMPAT_BASE_URL) and
 * `config.apiKey.openAiCompat` (or OPENAI_COMPAT_API_KEY). Mirrors the chat
 * `SmolOpenAiCompat` client. Inherits OpenAI's `mp3` default format.
 */
export class OpenAiCompatSpeechClient extends OpenAISpeechClient {
  protected override makeClient(): OpenAI {
    const baseURL = resolveBaseUrl("openai-compat", { baseUrl: this.config.baseUrl });
    if (!baseURL) {
      throw new Error(
        "openai-compat: base URL required (config.baseUrl.openAiCompat or OPENAI_COMPAT_BASE_URL).",
      );
    }
    return new OpenAI({ apiKey: this.config.apiKey, baseURL });
  }
}
