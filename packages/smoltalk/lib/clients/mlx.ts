import { SmolOpenAiCompat } from "./openaiCompat.js";
import type { PromptResult, SmolConfig } from "../types.js";
import type { Result } from "../types/result.js";
import { resolveBaseUrl } from "../util/provider.js";
import {
  separatesStructuredOutput,
  toolsThenStructuredOutput,
} from "./structuredAfterTools.js";

/**
 * Client for an MLX server on localhost, usually started with `mlx_lm.server`
 * (or `agency local serve`). The server speaks the OpenAI chat format, so this
 * is the openai-compat client with three things fixed: the base URL has a
 * default, no API key is needed, and the cost is always zero.
 *
 * A call with both tools and a `responseFormat` is made as two requests (see
 * structuredAfterTools.ts). The second keeps the tool list and sends
 * `tool_choice: "none"`. Keeping the list matters: the chat template renders
 * the tools at the start of the prompt, so dropping them would make the
 * server read the whole prompt again instead of reusing its cache. A server
 * that enforces a schema when `tool_choice` is `"none"` (`agency local
 * serve`) then holds the reply to the format. Streaming calls are not split:
 * as on Google, a streamed call with tools leaves the format unenforced.
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

  async _textSync(config: SmolConfig): Promise<Result<PromptResult>> {
    if (!separatesStructuredOutput(config)) {
      return super._textSync(config);
    }
    return toolsThenStructuredOutput({
      config,
      run: (one) => super._textSync(one),
      formatConfig: (followUp) => ({
        ...followUp,
        rawAttributes: { ...followUp.rawAttributes, tool_choice: "none" },
      }),
    });
  }
}
