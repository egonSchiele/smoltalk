import { SmolOpenAi } from "./openai.js";
import type { ClientAttachmentCapabilities } from "./baseClient.js";
import type { SmolConfig } from "../types.js";
import { resolveApiKey, resolveBaseUrl } from "../util/provider.js";

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

  protected resolveCostUsd(usage: any): number | undefined {
    // Try the three common conventions across OpenAI-compatible providers.
    const c = usage?.cost ?? usage?.estimated_cost ?? usage?.cost_usd;
    return typeof c === "number" ? c : undefined;
  }
}
