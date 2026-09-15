import OpenAI from "openai";
import { Result, success } from "../types/result.js";
import { resolveBaseUrl } from "../util/provider.js";
import type { SpeakFormat } from "../util/audioMime.js";
import { OpenAISpeechClient } from "./openai.js";
import type { SpeechResult } from "../speech.js";

/** How long one request may take. Equal to the SDK default; stated here so
 *  the ceiling is visible. A local model generating a long piece of text is
 *  slow, and the caller keeps its requests short. */
const MLX_SPEECH_TIMEOUT_MS = 600_000;

/**
 * Speech from an MLX server on localhost, usually `agency local serve
 * --speech <model>`. The same request the OpenAI client makes, with the
 * things the chat and embedding mlx clients also fix: the base URL has a
 * default, the key is a placeholder the server ignores, and the cost is
 * zero. It also never retries. The server runs one generation at a time,
 * so a retry would wait behind the request that just timed out and then
 * generate the same text again.
 */
export class MlxSpeechClient extends OpenAISpeechClient {
  protected override makeClient(): OpenAI {
    // resolveBaseUrl always returns a value for "mlx" (it has a default).
    const baseURL = resolveBaseUrl("mlx", { baseUrl: this.config.baseUrl })!;
    // The OpenAI SDK refuses an empty key. The local server never reads it.
    return new OpenAI({
      apiKey: "mlx-local",
      baseURL,
      maxRetries: 0,
      timeout: MLX_SPEECH_TIMEOUT_MS,
    });
  }

  protected override requiresKey(): boolean {
    return false;
  }

  protected override defaultFormat(): SpeakFormat {
    return "wav";
  }

  protected override async _speak(text: string): Promise<Result<SpeechResult>> {
    const result = await super._speak(text);
    if (!result.success) {
      return result;
    }
    return success({
      ...result.value,
      cost: { inputCost: 0, outputCost: 0, totalCost: 0, currency: "USD" },
    });
  }
}
