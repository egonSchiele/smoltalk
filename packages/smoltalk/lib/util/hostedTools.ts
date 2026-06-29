import { getHostedTools, hostedToolPricingFor } from "../models.js";
import type { ModelDataBlob } from "../modelData.js";
import type { CostEstimate } from "../types/costEstimate.js";
import type { HostedToolResult, WebSearchSource, WebSearchCitation } from "../types.js";
import { getModel } from "../models.js";
import { round } from "./util.js";

export const WEB_SEARCH = "web_search";

// Capabilities whose runtime translation/parsing smoltalk actually implements.
export const IMPLEMENTED_HOSTED_TOOLS = new Set<string>([WEB_SEARCH]);

// Returns an error message if any requested capability is unusable for this
// model, else null. Capabilities are matched against the catalog `category`.
// A `provider` override is authoritative: the same model can route through a
// different API (e.g. gpt-4o-mini via "openai-responses"), which changes which
// hosted tools are available.
export function validateHostedTools(
  requested: string[] | undefined,
  model: string,
  provider?: string,
  modelData?: ModelDataBlob,
): string | null {
  if (!requested || requested.length === 0) {
    return null;
  }
  const allCategories = new Set(
    getHostedTools({ includeDisabled: true, modelData }).map((t) => t.category),
  );
  const availableCategories = new Set(
    getHostedTools({ model, provider, modelData }).map((t) => t.category),
  );
  for (const name of requested) {
    if (!IMPLEMENTED_HOSTED_TOOLS.has(name)) {
      if (allCategories.has(name)) {
        return `Hosted tool "${name}" is in the catalog but not yet supported by smoltalk at runtime.`;
      }
      return `Unknown hosted tool "${name}".`;
    }
    if (!availableCategories.has(name)) {
      let effectiveProvider = provider;
      if (!effectiveProvider) {
        effectiveProvider = getModel(model, modelData)?.provider ?? "unknown";
      }
      return `${name} is a hosted capability; ${model} (${effectiveProvider}) doesn't offer it — pass a search function as a tool instead.`;
    }
  }
  return null;
}

// callCount x catalog price for the capability on this model. Only per_call
// pricing yields a number (web search); undefined otherwise.
export function estimateHostedToolCost(
  result: HostedToolResult,
  model: string,
  modelData?: ModelDataBlob,
): number | undefined {
  if (!result.callCount) {
    return undefined;
  }
  // The result names the provider that produced it, which may differ from the
  // model's registered provider (e.g. a base model routed through Responses).
  // Use it so the catalog lookup isn't filtered out by the wrong provider.
  const tools = getHostedTools({
    model,
    provider: result.provider,
    includeDisabled: true,
    modelData,
  });
  const tool = tools.find(
    (t) => t.category === result.tool && t.provider === result.provider,
  );
  if (!tool) {
    return undefined;
  }
  const price = hostedToolPricingFor(tool, model);
  if (!price || price.unit !== "per_call" || price.amount === undefined) {
    return undefined;
  }
  return round(result.callCount * price.amount, 6);
}

// Fold per-result estimatedCost into a CostEstimate (hostedToolsCost + totalCost).
export function foldHostedToolCost(
  cost: CostEstimate | undefined,
  results: HostedToolResult[],
): CostEstimate | undefined {
  let hosted = 0;
  for (const r of results) {
    if (r.estimatedCost) {
      hosted += r.estimatedCost;
    }
  }
  if (hosted === 0) {
    return cost;
  }
  const hostedRounded = round(hosted, 6);
  if (!cost) {
    return {
      inputCost: 0,
      outputCost: 0,
      hostedToolsCost: hostedRounded,
      totalCost: hostedRounded,
      currency: "USD",
    };
  }
  return {
    ...cost,
    hostedToolsCost: round((cost.hostedToolsCost || 0) + hosted, 6),
    totalCost: round(cost.totalCost + hosted, 6),
  };
}

// Build a normalized web-search result, omitting empty fields. One place for the
// "assemble result" shape so each parser doesn't repeat it.
export function webSearchResult(
  provider: string,
  parts: {
    queries?: string[];
    sources?: WebSearchSource[];
    citations?: WebSearchCitation[];
    callCount?: number;
    raw?: unknown;
  },
): HostedToolResult {
  const result: HostedToolResult = { tool: WEB_SEARCH, provider };
  if (parts.queries && parts.queries.length > 0) {
    result.queries = parts.queries;
  }
  if (parts.sources && parts.sources.length > 0) {
    result.sources = parts.sources;
  }
  if (parts.citations && parts.citations.length > 0) {
    result.citations = parts.citations;
  }
  if (parts.callCount) {
    result.callCount = parts.callCount;
  }
  if (parts.raw !== undefined) {
    result.raw = parts.raw;
  }
  return result;
}

// Estimate per-result cost and fold the total into the CostEstimate. One call
// for every client, so the estimate+fold sequence lives in exactly one place.
export function applyHostedToolCost(
  results: HostedToolResult[],
  cost: CostEstimate | undefined,
  model: string,
  modelData?: ModelDataBlob,
): { results: HostedToolResult[]; cost: CostEstimate | undefined } {
  for (const r of results) {
    const est = estimateHostedToolCost(r, model, modelData);
    if (est !== undefined) {
      r.estimatedCost = est;
    }
  }
  return { results, cost: foldHostedToolCost(cost, results) };
}
