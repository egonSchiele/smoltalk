import { SmolOpenAi } from "./openai.js";
import type { ClientAttachmentCapabilities } from "./baseClient.js";
import type { SmolConfig } from "../types.js";
import { resolveApiKey, resolveBaseUrl } from "../util/provider.js";
import type { ReasoningPart } from "../util/reasoning.js";

/**
 * Generic OpenAI-compatible client. Use when pointing smoltalk at any
 * arbitrary OpenAI-shaped endpoint (vLLM, TGI, LM Studio, OpenLLM, etc.).
 *
 * Both `config.apiKey.openAiCompat` and `config.baseUrl.openAiCompat` are
 * required (or their env-var fallbacks: `OPENAI_COMPAT_API_KEY`,
 * `OPENAI_COMPAT_BASE_URL`).
 *
 * Cost: opportunistically reads `usage.cost`, `usage.estimated_cost`, or
 * `usage.cost_usd` if the backend includes one of them. Otherwise falls back
 * to the smoltalk model registry (which won't have these custom models, so
 * cost stays undefined — that's expected for arbitrary backends).
 */
export class SmolOpenAiCompat extends SmolOpenAi {
  // Compat endpoints speak the Chat Completions wire format but do not get
  // OpenAI's input_audio handling — declare no audio support.
  protected override attachmentCapabilities(): ClientAttachmentCapabilities {
    return { inputModalities: ["image", "pdf"], audioFormats: [] };
  }

  /** Compatible servers such as vLLM, DeepSeek and Kimi return reasoning in
   *  `reasoning_content`; some return it in `reasoning`. It goes back in
   *  the field it came in. */
  protected override readReasoning(part: any): ReasoningPart | undefined {
    if (typeof part?.reasoning_content === "string" && part.reasoning_content !== "") {
      return { text: part.reasoning_content, field: "reasoning_content" };
    }
    if (typeof part?.reasoning === "string" && part.reasoning !== "") {
      return { text: part.reasoning, field: "reasoning" };
    }
    return undefined;
  }

  protected resolveClientOptions(config: SmolConfig): {
    apiKey: string;
    baseURL: string;
  } {
    const apiKey = resolveApiKey("openai-compat", config);
    const baseURL = resolveBaseUrl("openai-compat", config);
    if (!apiKey) {
      throw new Error(
        "openai-compat: API key required (config.apiKey.openAiCompat or OPENAI_COMPAT_API_KEY).",
      );
    }
    if (!baseURL) {
      throw new Error(
        "openai-compat: base URL required (config.baseUrl.openAiCompat or OPENAI_COMPAT_BASE_URL).",
      );
    }
    return { apiKey, baseURL };
  }

  // Compat servers (OpenRouter, DeepInfra, LiteLLM, vLLM, mlx_lm.server) all
  // accept `max_tokens`; `max_completion_tokens` support is patchy.
  protected maxTokensParam(config: SmolConfig): Record<string, number> {
    if (config.maxTokens === undefined) {
      return {};
    }
    return { max_tokens: config.maxTokens };
  }

  protected resolveCostUsd(usage: any): number | undefined {
    // Try the three common conventions across OpenAI-compatible providers.
    const c = usage?.cost ?? usage?.estimated_cost ?? usage?.cost_usd;
    return typeof c === "number" ? c : undefined;
  }
}
