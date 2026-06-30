import { SmolOpenAiCompat } from "./openaiCompat.js";
import type { SmolConfig } from "../types.js";
import { resolveApiKey, resolveBaseUrl } from "../util/provider.js";

/**
 * DeepInfra client (https://deepinfra.com). OpenAI-compatible chat completions
 * at the `/v1/openai` base URL.
 *
 * - Baked base URL `https://api.deepinfra.com/v1/openai` (override via config.baseUrl.deepInfra).
 * - Key: config.apiKey.deepInfra or env DEEPINFRA_API_KEY.
 * - Cost: reads `usage.estimated_cost` (USD).
 */
export class SmolDeepInfra extends SmolOpenAiCompat {
  protected resolveClientOptions(config: SmolConfig): {
    apiKey: string;
    baseURL: string;
  } {
    const apiKey = resolveApiKey("deepinfra", config);
    // resolveBaseUrl bakes in the deepinfra default, so this is always defined.
    const baseURL = resolveBaseUrl("deepinfra", config)!;
    if (!apiKey) {
      throw new Error(
        "deepinfra: API key required (config.apiKey.deepInfra or DEEPINFRA_API_KEY).",
      );
    }
    return { apiKey, baseURL };
  }

  protected resolveCostUsd(usage: any): number | undefined {
    // DeepInfra returns usage.estimated_cost (USD) on chat completions.
    return typeof usage?.estimated_cost === "number"
      ? usage.estimated_cost
      : undefined;
  }
}
