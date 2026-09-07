import { SmolOpenAiCompat } from "./openaiCompat.js";
import type { SmolConfig } from "../types.js";
import { resolveBaseUrl } from "../util/provider.js";

/**
 * Client for an MLX server on localhost, usually started with `mlx_lm.server`
 * (or `agency local serve`). The server speaks the OpenAI chat format, so this
 * is the openai-compat client with three things fixed: the base URL has a
 * default, no API key is needed, and the cost is always zero.
 */
export class SmolMlx extends SmolOpenAiCompat {
  protected resolveClientOptions(config: SmolConfig): {
    apiKey: string;
    baseURL: string;
  } {
    // resolveBaseUrl always returns a value for "mlx" (it has a default).
    const baseURL = resolveBaseUrl("mlx", config)!;
    // The OpenAI SDK refuses an empty key. The local server never reads it.
    return { apiKey: "mlx-local", baseURL };
  }

  protected resolveCostUsd(): number {
    return 0;
  }
}
