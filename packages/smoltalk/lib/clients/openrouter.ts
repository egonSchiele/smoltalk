import { SmolOpenAiCompat } from "./openaiCompat.js";
import type {
  SmolConfig,
  HostedToolResult,
  OpenRouterProviderPreferences,
} from "../types.js";
import { webSearchResult } from "../util/hostedTools.js";
import { resolveApiKey, resolveBaseUrl } from "../util/provider.js";

const OPENROUTER_PROVIDER_FIELDS: Record<
  keyof OpenRouterProviderPreferences,
  string
> = {
  order: "order",
  only: "only",
  ignore: "ignore",
  allowFallbacks: "allow_fallbacks",
  requireParameters: "require_parameters",
  dataCollection: "data_collection",
  sort: "sort",
  quantizations: "quantizations",
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The request's `provider` object: only the fields that are set, under
 *  OpenRouter's names. */
export function toOpenRouterProvider(
  prefs: OpenRouterProviderPreferences,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, wireName] of Object.entries(OPENROUTER_PROVIDER_FIELDS)) {
    const value = prefs[key as keyof OpenRouterProviderPreferences];
    if (value !== undefined) out[wireName] = value;
  }
  return out;
}

/**
 * OpenRouter client (https://openrouter.ai). OpenAI-compatible chat completions.
 *
 * - Baked base URL `https://openrouter.ai/api/v1` (override via config.baseUrl.openRouter).
 * - Key: config.apiKey.openRouter or env OPENROUTER_API_KEY.
 * - Cost: reads `usage.cost` (USD). OpenRouter includes this in every
 *   response (in the final SSE chunk when streaming); no request flag needed.
 * - Provider routing: config.openRouter.provider becomes the request's
 *   `provider` field, in OpenRouter's snake_case names.
 * - The reply's top-level `provider` (the company that ran the model) and
 *   `message.reasoning` become `servedBy` and `reasoning` on the result.
 * - Hosted web_search: when config.hostedTools includes "web_search",
 *   injects `plugins: [{ id: "web", max_results: 5 }]` and parses
 *   message.annotations into a HostedToolResult.
 */
export class SmolOpenRouter extends SmolOpenAiCompat {
  protected resolveClientOptions(config: SmolConfig): {
    apiKey: string;
    baseURL: string;
  } {
    const apiKey = resolveApiKey("openrouter", config);
    // resolveBaseUrl bakes in the openrouter default, so this is always defined.
    const baseURL = resolveBaseUrl("openrouter", config)!;
    if (!apiKey) {
      throw new Error(
        "openrouter: API key required (config.apiKey.openRouter or OPENROUTER_API_KEY).",
      );
    }
    return { apiKey, baseURL };
  }

  protected resolveCostUsd(usage: any): number | undefined {
    return typeof usage?.cost === "number" ? usage.cost : undefined;
  }

  protected readServedBy(body: any): string | undefined {
    return nonEmptyString(body?.provider);
  }

  protected readReasoning(part: any): string | undefined {
    return nonEmptyString(part?.reasoning);
  }

  protected buildRequestExtras(config: SmolConfig): Record<string, unknown> {
    const extras: Record<string, unknown> = {};
    if (config.hostedTools?.includes("web_search")) {
      extras.plugins = [{ id: "web", max_results: 5 }];
    }
    if (config.openRouter?.provider) {
      extras.provider = toOpenRouterProvider(config.openRouter.provider);
    }
    return extras;
  }

  protected parseHostedToolResults(
    completion: any,
    config: SmolConfig,
  ): HostedToolResult[] {
    if (!config.hostedTools?.includes("web_search")) return [];
    const annotations = completion?.choices?.[0]?.message?.annotations;
    if (!Array.isArray(annotations) || annotations.length === 0) return [];

    const sources: { url: string; title?: string; snippet?: string }[] = [];
    const citations: {
      url: string;
      title?: string;
      startIndex?: number;
      endIndex?: number;
    }[] = [];

    for (const a of annotations) {
      if (a?.type !== "url_citation" || !a.url_citation?.url) continue;
      const uc = a.url_citation;

      const source: { url: string; title?: string; snippet?: string } = {
        url: uc.url,
      };
      if (uc.title) source.title = uc.title;
      if (uc.content) source.snippet = uc.content;
      sources.push(source);

      const citation: {
        url: string;
        title?: string;
        startIndex?: number;
        endIndex?: number;
      } = { url: uc.url };
      if (uc.title) citation.title = uc.title;
      if (typeof uc.start_index === "number") citation.startIndex = uc.start_index;
      if (typeof uc.end_index === "number") citation.endIndex = uc.end_index;
      citations.push(citation);
    }

    if (sources.length === 0) return [];
    return [
      webSearchResult("openrouter", {
        sources,
        citations,
        callCount: 1,
      }),
    ];
  }
}
