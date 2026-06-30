import { SmolOpenAiCompat } from "./openaiCompat.js";
import type { SmolConfig } from "../types.js";

/**
 * LiteLLM proxy client (https://docs.litellm.ai/docs/simple_proxy). OpenAI-
 * compatible chat completions through a user-run LiteLLM proxy.
 *
 * - Base URL is REQUIRED from config.baseUrl.liteLlm or env LITELLM_BASE_URL.
 * - Key: config.apiKey.liteLlm or env LITELLM_API_KEY.
 * - Cost: reads the `x-litellm-response-cost` header (USD). Only available
 *   for non-streaming responses; streaming requests fall back to the
 *   smoltalk model registry.
 */
export class SmolLiteLlm extends SmolOpenAiCompat {
  protected resolveClientOptions(config: SmolConfig): {
    apiKey: string;
    baseURL: string;
  } {
    const apiKey = config.apiKey?.liteLlm || process.env.LITELLM_API_KEY;
    const baseURL = config.baseUrl?.liteLlm || process.env.LITELLM_BASE_URL;
    if (!apiKey) {
      throw new Error(
        "litellm: API key required (config.apiKey.liteLlm or LITELLM_API_KEY).",
      );
    }
    if (!baseURL) {
      throw new Error(
        "litellm: base URL required (config.baseUrl.liteLlm or LITELLM_BASE_URL).",
      );
    }
    return { apiKey, baseURL };
  }

  protected resolveCostUsd(
    _usage: any,
    rawResponse?: Response,
  ): number | undefined {
    const header = rawResponse?.headers?.get?.("x-litellm-response-cost");
    if (!header) return undefined;
    const n = Number(header);
    return Number.isFinite(n) ? n : undefined;
  }
}
