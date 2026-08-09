import OpenAI from "openai";
import { OpenAITranscriptionClient } from "./openai.js";
import { resolveBaseUrl } from "../util/provider.js";

/**
 * Generic OpenAI-compatible transcription client. Point it at any provider
 * exposing an OpenAI-shaped /audio/transcriptions endpoint via
 * `config.baseUrl.openAiCompat` (or OPENAI_COMPAT_BASE_URL) and
 * `config.apiKey.openAiCompat` (or OPENAI_COMPAT_API_KEY). Mirrors the chat
 * `SmolOpenAiCompat` client.
 */
export class OpenAiCompatTranscriptionClient extends OpenAITranscriptionClient {
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
