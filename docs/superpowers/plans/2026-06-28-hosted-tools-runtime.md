# Hosted-tools Runtime (Web Search) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a caller enable a provider hosted tool on an LLM call via `config.hostedTools: ["web_search"]` and get normalized search results + an estimated cost back in `PromptResult`, across Anthropic, Google, and OpenAI Responses.

**Architecture:** A capability name in `config.hostedTools` is matched against the hosted-tool catalog's `category` (so one name spans providers — Google's tool is `google_search`/category `web_search`). `baseClient` validates requested capabilities against the catalog before any network call. Each client translates a supported capability into its native tool config and parses the provider's response into a normalized `HostedToolResult`. Cost is estimated from returned usage counts × catalog price.

**Tech Stack:** TypeScript (ESNext, `nodenext`, `strict`), zod v4, vitest.

## Global Constraints

- **ES Modules:** internal imports use `.js` extensions.
- **No ternaries / conditional spreads:** explicit `if` statements (user preference). (Existing code has some; do not add new ones.)
- **Result type:** validation failures return `failure(message)` from `lib/types/result.js`.
- **Capability key = catalog `category`.** `config.hostedTools` entries are matched against `HostedTool.category`, not `name` (Google's search tool is `google_search`). v1 implements only the `web_search` capability.
- **Cost is an estimate:** `callCount × catalog price`; providers return usage counts, never charged dollars; free-tier allowances are stateful and ignored (upper bound). Only `per_call` pricing yields a number.
- **SDK field access:** provider response objects don't fully type server-tool blocks; use `(x as any)` for those fields, consistent with existing code (e.g. `(block as any).type === "thinking"`).
- **Tests:** `*.test.ts` beside code; run `pnpm exec vitest run <file>`; full suite `pnpm test`; types `pnpm typecheck`; build `pnpm build`. `*.test.ts` is excluded from tsconfig — verify type-only changes via `pnpm typecheck` of lib + `pnpm build`.
- **Catalog distribution:** regenerate `data/model-data.json` with `pnpm refresh-data` (NOT `seed-data`, which drops models.dev enrichment).
- Paths are relative to `packages/smoltalk/`.

---

### Task 1: Types — config field, result types, cost field

**Files:**
- Modify: `lib/types.ts` (`SmolConfig`, `PromptResult`, `promptResult`, new result types)
- Modify: `lib/types/costEstimate.ts` (`CostEstimate` + schema)
- Test: `lib/types.hostedTools.test.ts`

**Interfaces:**
- Produces:
  - `SmolConfig.hostedTools?: string[]`
  - `type WebSearchSource = { url: string; title?: string; snippet?: string }`
  - `type WebSearchCitation = { url: string; title?: string; startIndex?: number; endIndex?: number }`
  - `type HostedToolResult = { tool: string; provider: string; queries?: string[]; sources?: WebSearchSource[]; citations?: WebSearchCitation[]; callCount?: number; estimatedCost?: number; raw?: unknown }`
  - `PromptResult.hostedToolResults?: HostedToolResult[]`
  - `CostEstimate.hostedToolsCost?: number`

- [ ] **Step 1: Write the failing test**

Create `lib/types.hostedTools.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { promptResult } from "./types.js";
import type { HostedToolResult } from "./types.js";

describe("promptResult with hostedToolResults", () => {
  it("passes hostedToolResults through", () => {
    const htr: HostedToolResult[] = [
      { tool: "web_search", provider: "anthropic", queries: ["ts 6.0"], callCount: 1, estimatedCost: 0.01 },
    ];
    const r = promptResult({ output: "hi", hostedToolResults: htr });
    expect(r.hostedToolResults).toHaveLength(1);
    expect(r.hostedToolResults?.[0].queries).toEqual(["ts 6.0"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/types.hostedTools.test.ts`
Expected: FAIL — `promptResult` ignores `hostedToolResults` (not in the destructure), so it's `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `lib/types.ts`, add the result types above `PromptResult` (e.g. just before `export type PromptResult`):

```ts
export type WebSearchSource = {
  url: string;
  title?: string;
  snippet?: string;
};

export type WebSearchCitation = {
  url: string;
  title?: string;
  startIndex?: number;
  endIndex?: number;
};

export type HostedToolResult = {
  tool: string;                    // capability name (catalog category), e.g. "web_search"
  provider: string;
  queries?: string[];
  sources?: WebSearchSource[];
  citations?: WebSearchCitation[];
  callCount?: number;              // billable operations the provider reported
  estimatedCost?: number;         // USD; callCount x catalog price; undefined if not derivable
  raw?: unknown;                   // provider payload, unnormalized (escape hatch)
};
```

Add `hostedToolResults` to `PromptResult`:

```ts
export type PromptResult = {
  output: string | null;
  toolCalls: ToolCall[];
  thinkingBlocks?: ThinkingBlock[];
  usage?: TokenUsage;
  cost?: CostEstimate;
  model?: ModelName;
  hostedToolResults?: HostedToolResult[];
};
```

Update `promptResult` to accept and pass it through:

```ts
export function promptResult({
  output,
  toolCalls,
  thinkingBlocks,
  usage,
  cost,
  model,
  hostedToolResults,
}: Partial<PromptResult>): PromptResult {
  return {
    output: output || null,
    toolCalls: toolCalls || [],
    thinkingBlocks: thinkingBlocks,
    usage,
    cost,
    model,
    hostedToolResults,
  };
}
```

Add the config field to `SmolConfig` (after the `tools` field):

```ts
  /** Provider hosted tools (server-side) to enable for this call, by capability
   *  name (catalog category), e.g. ["web_search"]. Distinct from `tools`
   *  (client functions) — hosted tools run server-side and can't be intercepted. */
  hostedTools?: string[];
```

In `lib/types/costEstimate.ts`, add `hostedToolsCost` to the type and schema:

```ts
export type CostEstimate = {
  inputCost: number;
  outputCost: number;
  cachedInputCost?: number;
  cacheCreationInputCost?: number;
  hostedToolsCost?: number;
  totalCost: number;
  currency: string;
};

export const CostEstimateSchema = z.object({
  inputCost: z.number(),
  outputCost: z.number(),
  cachedInputCost: z.number().optional(),
  cacheCreationInputCost: z.number().optional(),
  hostedToolsCost: z.number().optional(),
  totalCost: z.number(),
  currency: z.string(),
});
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm exec vitest run lib/types.hostedTools.test.ts && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts lib/types/costEstimate.ts lib/types.hostedTools.test.ts
git commit -m "feat(hostedTools): config.hostedTools + normalized result/cost types"
```

---

### Task 2: Shared hosted-tools utilities

**Files:**
- Create: `lib/util/hostedTools.ts`
- Test: `lib/util/hostedTools.test.ts`

**Interfaces:**
- Consumes: `getHostedTools`, `hostedToolPricingFor` from `lib/models.js`; `HostedTool` from `lib/modelData.js`; `CostEstimate` from `lib/types/costEstimate.js`; `HostedToolResult` from `lib/types.js`; `round` from `lib/util/util.js`.
- Produces:
  - `const WEB_SEARCH = "web_search"`
  - `const IMPLEMENTED_HOSTED_TOOLS: Set<string>` (v1: `{ "web_search" }`)
  - `validateHostedTools(requested: string[] | undefined, model: string, modelData?: ModelDataBlob): string | null`
  - `estimateHostedToolCost(result: HostedToolResult, model: string, modelData?: ModelDataBlob): number | undefined`
  - `foldHostedToolCost(cost: CostEstimate | undefined, results: HostedToolResult[]): CostEstimate | undefined`

- [ ] **Step 1: Write the failing test**

Create `lib/util/hostedTools.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateHostedTools, estimateHostedToolCost, foldHostedToolCost } from "./hostedTools.js";
import type { HostedToolResult } from "../types.js";

describe("validateHostedTools", () => {
  it("accepts web_search for a supporting model", () => {
    expect(validateHostedTools(["web_search"], "claude-opus-4-8")).toBeNull();
  });
  it("accepts web_search for a google model (matched by category)", () => {
    expect(validateHostedTools(["web_search"], "gemini-2.5-flash")).toBeNull();
  });
  it("rejects web_search for an unknown model / provider with no such tool", () => {
    const msg = validateHostedTools(["web_search"], "totally-unknown-model");
    expect(msg).toContain("web_search");
  });
  it("rejects an unimplemented capability", () => {
    expect(validateHostedTools(["code_execution"], "claude-opus-4-8")).toContain("not yet supported");
  });
  it("rejects an unknown capability", () => {
    expect(validateHostedTools(["nonsense"], "claude-opus-4-8")).toContain("Unknown");
  });
  it("returns null for empty/undefined", () => {
    expect(validateHostedTools(undefined, "claude-opus-4-8")).toBeNull();
    expect(validateHostedTools([], "claude-opus-4-8")).toBeNull();
  });
});

describe("estimateHostedToolCost", () => {
  it("computes callCount x per-call price", () => {
    const r: HostedToolResult = { tool: "web_search", provider: "anthropic", callCount: 3 };
    // anthropic web_search is $0.01/call
    expect(estimateHostedToolCost(r, "claude-opus-4-8")).toBeCloseTo(0.03, 6);
  });
  it("applies per-model overrides (gemini 2.5 = $0.035)", () => {
    const r: HostedToolResult = { tool: "web_search", provider: "google", callCount: 1 };
    expect(estimateHostedToolCost(r, "gemini-2.5-flash")).toBeCloseTo(0.035, 6);
  });
  it("returns undefined without a callCount", () => {
    const r: HostedToolResult = { tool: "web_search", provider: "anthropic" };
    expect(estimateHostedToolCost(r, "claude-opus-4-8")).toBeUndefined();
  });
});

describe("foldHostedToolCost", () => {
  it("adds hostedToolsCost into the estimate and totalCost", () => {
    const base = { inputCost: 0.1, outputCost: 0.2, totalCost: 0.3, currency: "USD" };
    const out = foldHostedToolCost(base, [{ tool: "web_search", provider: "anthropic", estimatedCost: 0.05 }]);
    expect(out?.hostedToolsCost).toBeCloseTo(0.05, 6);
    expect(out?.totalCost).toBeCloseTo(0.35, 6);
  });
  it("returns the base unchanged when there is no hosted cost", () => {
    const base = { inputCost: 0.1, outputCost: 0.2, totalCost: 0.3, currency: "USD" };
    expect(foldHostedToolCost(base, [])).toBe(base);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/util/hostedTools.test.ts`
Expected: FAIL — module `./hostedTools.js` not found.

- [ ] **Step 3: Write minimal implementation**

Create `lib/util/hostedTools.ts`:

```ts
import { getHostedTools, hostedToolPricingFor } from "../models.js";
import type { ModelDataBlob } from "../modelData.js";
import type { CostEstimate } from "../types/costEstimate.js";
import type { HostedToolResult } from "../types.js";
import { getModel } from "../models.js";
import { round } from "./util.js";

export const WEB_SEARCH = "web_search";

// Capabilities whose runtime translation/parsing smoltalk actually implements.
export const IMPLEMENTED_HOSTED_TOOLS = new Set<string>([WEB_SEARCH]);

// Returns an error message if any requested capability is unusable for this
// model, else null. Capabilities are matched against the catalog `category`.
export function validateHostedTools(
  requested: string[] | undefined,
  model: string,
  modelData?: ModelDataBlob,
): string | null {
  if (!requested || requested.length === 0) {
    return null;
  }
  const allCategories = new Set(
    getHostedTools({ includeDisabled: true, modelData }).map((t) => t.category),
  );
  const availableCategories = new Set(
    getHostedTools({ model, modelData }).map((t) => t.category),
  );
  for (const name of requested) {
    if (!IMPLEMENTED_HOSTED_TOOLS.has(name)) {
      if (allCategories.has(name)) {
        return `Hosted tool "${name}" is in the catalog but not yet supported by smoltalk at runtime.`;
      }
      return `Unknown hosted tool "${name}".`;
    }
    if (!availableCategories.has(name)) {
      const provider = getModel(model, modelData)?.provider ?? "unknown";
      return `${name} is a hosted capability; ${model} (${provider}) doesn't offer it — pass a search function as a tool instead.`;
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
  const tools = getHostedTools({ model, includeDisabled: true, modelData });
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
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm exec vitest run lib/util/hostedTools.test.ts && pnpm typecheck`
Expected: PASS (all tests green; the gpt-4o vs gpt-5 catalog behavior is tested in Task 3).

- [ ] **Step 5: Commit**

```bash
git add lib/util/hostedTools.ts lib/util/hostedTools.test.ts
git commit -m "feat(hostedTools): validation + cost-estimate utilities"
```

---

### Task 3: Catalog reconciliation — OpenAI hosted tools → openai-responses

**Files:**
- Modify: `lib/models.ts` (the 4 OpenAI entries in the `hostedTools` const)
- Modify: `data/model-data.json` (regenerated)
- Test: extend `lib/util/hostedTools.test.ts` (gpt-4o rejection now passes) + a catalog assertion

**Interfaces:**
- Consumes: nothing new.

- [ ] **Step 1: Add the failing assertion**

Append to `lib/util/hostedTools.test.ts`:

```ts
import { getHostedTools } from "../models.js";

describe("OpenAI hosted tools are Responses-API tools", () => {
  it("web_search is available for gpt-5 (openai-responses) but not gpt-4o (openai)", () => {
    const forGpt5 = getHostedTools({ model: "gpt-5" }).map((t) => t.category);
    const forGpt4o = getHostedTools({ model: "gpt-4o" }).map((t) => t.category);
    expect(forGpt5).toContain("web_search");
    expect(forGpt4o).not.toContain("web_search");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/util/hostedTools.test.ts`
Expected: FAIL — OpenAI hosted tools are under provider `openai`, so `gpt-4o` still sees `web_search`.

- [ ] **Step 3: Change the 4 OpenAI hosted-tool entries to `openai-responses`**

In `lib/models.ts`, in the `hostedTools` const, change `provider: "openai"` to `provider: "openai-responses"` on the four OpenAI entries — `web_search`, `file_search`, `code_interpreter`, `image_generation`. Do NOT touch the model arrays (which also contain `provider: "openai"`). Edit each by anchoring on its `name`. For example, for `web_search`:

```ts
  {
    name: "web_search",
    provider: "openai-responses",
    category: "web_search",
    description: "Server-side web search (Responses API).",
    providerToolId: "web_search",
    pricing: { unit: "per_call", amount: 0.01, note: "$10/1k standard; $25/1k preview non-reasoning; plus ~8k input tokens per call. Varies by search_context_size." },
  },
```

Repeat for `file_search`, `code_interpreter`, `image_generation` (change only the `provider` line).

- [ ] **Step 4: Run tests + typecheck + regenerate artifact**

Run: `pnpm exec vitest run lib/util/hostedTools.test.ts && pnpm typecheck`
Expected: PASS (gpt-4o rejection and the catalog assertion both green now).

Run: `pnpm refresh-data`
Expected: writes `data/model-data.json`. Verify OpenAI tools moved:

Run: `node -e "const b=require('./data/model-data.json'); console.log(b.hostedTools.filter(t=>t.category && ['web_search','file_search','code_execution','image_generation'].includes(t.category)).map(t=>t.provider+':'+t.name).join(' | '))"`
Expected: OpenAI entries show `openai-responses:...`.

- [ ] **Step 5: Commit**

```bash
git add lib/models.ts lib/util/hostedTools.test.ts data/model-data.json
git commit -m "fix(hostedTools): OpenAI hosted tools are Responses-API tools (openai-responses)"
```

---

### Task 4: baseClient validation hookup

**Files:**
- Modify: `lib/clients/baseClient.ts` (`textSync` ~line 84, `textStream` ~line 370)
- Test: `lib/clients/baseClient.hostedTools.test.ts`

**Interfaces:**
- Consumes: `validateHostedTools` (Task 2); `failure` from `lib/types/result.js`.

- [ ] **Step 1: Write the failing test**

Create `lib/clients/baseClient.hostedTools.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { textSync } from "../functions.js";
import { UserMessage } from "../classes/message/index.js";

describe("hosted-tool validation runs before any network call", () => {
  it("fails fast for a model whose provider lacks the capability", async () => {
    const result = await textSync({
      model: "gpt-4o", // openai chat — no hosted web_search
      hostedTools: ["web_search"],
      messages: [new UserMessage("hi")],
      openAiApiKey: "sk-not-used",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("web_search");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/clients/baseClient.hostedTools.test.ts`
Expected: FAIL — no validation yet; the call proceeds toward the network (and fails for a different reason / hangs). After implementation it returns a clean validation failure.

- [ ] **Step 3: Wire validation into baseClient**

In `lib/clients/baseClient.ts`, add imports near the top:

```ts
import { validateHostedTools } from "../util/hostedTools.js";
import { failure } from "../types/result.js";
```

In `textSync`, immediately after the `checkMessageLimit` guard (after line ~86):

```ts
    const hostedError = validateHostedTools(
      promptConfig.hostedTools,
      promptConfig.model,
      promptConfig.modelData,
    );
    if (hostedError) {
      return failure(hostedError);
    }
```

In `textStream`, after its `checkMessageLimit` guard (after line ~381):

```ts
    const hostedError = validateHostedTools(
      config.hostedTools,
      config.model,
      config.modelData,
    );
    if (hostedError) {
      yield { type: "error", error: hostedError };
      return;
    }
```

- [ ] **Step 4: Run test + typecheck + full suite**

Run: `pnpm exec vitest run lib/clients/baseClient.hostedTools.test.ts && pnpm typecheck && pnpm test`
Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add lib/clients/baseClient.ts lib/clients/baseClient.hostedTools.test.ts
git commit -m "feat(hostedTools): validate requested capabilities in baseClient before dispatch"
```

---

### Task 5: Anthropic — translate + parse + cost

**Files:**
- Modify: `lib/clients/anthropic.ts`
- Test: `lib/clients/anthropic.hostedTools.test.ts`

**Interfaces:**
- Consumes: `WEB_SEARCH`, `estimateHostedToolCost`, `foldHostedToolCost` (Task 2); `HostedToolResult` (Task 1).
- Produces (exported pure fns for testing): `anthropicWebSearchEntries(hostedTools?: string[]): any[]`, `parseAnthropicHostedTools(response: any, provider: string): HostedToolResult[]`.

- [ ] **Step 1: Write the failing test**

Create `lib/clients/anthropic.hostedTools.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { anthropicWebSearchEntries, parseAnthropicHostedTools } from "./anthropic.js";

describe("anthropicWebSearchEntries", () => {
  it("emits the native web_search tool when requested", () => {
    expect(anthropicWebSearchEntries(["web_search"])).toEqual([
      { type: "web_search_20250305", name: "web_search" },
    ]);
  });
  it("emits nothing when not requested", () => {
    expect(anthropicWebSearchEntries(undefined)).toEqual([]);
    expect(anthropicWebSearchEntries([])).toEqual([]);
  });
});

describe("parseAnthropicHostedTools", () => {
  it("normalizes server_tool_use + web_search_tool_result + citations + count", () => {
    const response = {
      content: [
        { type: "server_tool_use", name: "web_search", input: { query: "ts 6.0" } },
        { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://ts.dev/6", title: "TS 6" }] },
        { type: "text", text: "TS 6 shipped.", citations: [{ url: "https://ts.dev/6", title: "TS 6" }] },
      ],
      usage: { server_tool_use: { web_search_requests: 1 } },
    };
    const out = parseAnthropicHostedTools(response, "anthropic");
    expect(out).toHaveLength(1);
    expect(out[0].tool).toBe("web_search");
    expect(out[0].queries).toEqual(["ts 6.0"]);
    expect(out[0].sources?.[0].url).toBe("https://ts.dev/6");
    expect(out[0].citations?.[0].url).toBe("https://ts.dev/6");
    expect(out[0].callCount).toBe(1);
  });
  it("returns [] when no web search happened", () => {
    expect(parseAnthropicHostedTools({ content: [{ type: "text", text: "hi" }], usage: {} }, "anthropic")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/clients/anthropic.hostedTools.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement translation, parsing, and wiring**

In `lib/clients/anthropic.ts`, add imports near the top (with the other `../util` / `../types` imports):

```ts
import { WEB_SEARCH, estimateHostedToolCost, foldHostedToolCost } from "../util/hostedTools.js";
import type { HostedToolResult } from "../types.js";
```

Add these exported pure functions (e.g. near `thinkingStyleFor`, module scope):

```ts
export function anthropicWebSearchEntries(hostedTools?: string[]): any[] {
  if (hostedTools && hostedTools.includes(WEB_SEARCH)) {
    return [{ type: "web_search_20250305", name: "web_search" }];
  }
  return [];
}

export function parseAnthropicHostedTools(
  response: any,
  provider: string,
): HostedToolResult[] {
  const queries: string[] = [];
  const sources: { url: string; title?: string }[] = [];
  const citations: { url: string; title?: string }[] = [];
  for (const block of response.content || []) {
    if (block.type === "server_tool_use" && block.name === "web_search") {
      const query = block.input?.query;
      if (typeof query === "string") {
        queries.push(query);
      }
    } else if (block.type === "web_search_tool_result") {
      for (const r of block.content || []) {
        if (r && typeof r.url === "string") {
          sources.push({ url: r.url, title: r.title });
        }
      }
    } else if (block.type === "text" && Array.isArray(block.citations)) {
      for (const c of block.citations) {
        if (c && typeof c.url === "string") {
          citations.push({ url: c.url, title: c.title });
        }
      }
    }
  }
  const callCount = response.usage?.server_tool_use?.web_search_requests;
  const used = queries.length > 0 || sources.length > 0 || (callCount ?? 0) > 0;
  if (!used) {
    return [];
  }
  const result: HostedToolResult = { tool: WEB_SEARCH, provider };
  if (queries.length > 0) {
    result.queries = queries;
  }
  if (sources.length > 0) {
    result.sources = sources;
  }
  if (citations.length > 0) {
    result.citations = citations;
  }
  if (callCount !== undefined) {
    result.callCount = callCount;
  }
  return [result];
}
```

Wire translation into `buildRequest` — extend the `tools` assembly (around line 245-252) so hosted entries are appended:

```ts
    const functionTools =
      config.tools && config.tools.length > 0
        ? (config.tools.map((tool) =>
            zodToAnthropicTool(tool.name, tool.schema, {
              description: tool.description,
            }),
          ) as Tool[])
        : [];
    const hostedEntries = anthropicWebSearchEntries(config.hostedTools);
    const allTools = [...functionTools, ...hostedEntries] as Tool[];
    const tools = allTools.length > 0 ? allTools : undefined;
```

Wire parsing + cost into the `_textSync` result assembly (replace the `const { usage, cost } = ...; return success({...})` block at ~398-407):

```ts
    const { usage, cost } = this.calculateUsageAndCost(response.usage);
    const hostedToolResults = parseAnthropicHostedTools(response, "anthropic");
    for (const r of hostedToolResults) {
      r.estimatedCost = estimateHostedToolCost(r, this.getModel(), this.config.modelData);
    }
    const finalCost = foldHostedToolCost(cost, hostedToolResults);

    return success({
      output,
      toolCalls,
      ...(thinkingBlocks.length > 0 && { thinkingBlocks }),
      usage,
      cost: finalCost,
      model: this.getModel(),
      ...(hostedToolResults.length > 0 && { hostedToolResults }),
    });
```

(Streaming: v1 populates `hostedToolResults` on the sync `textSync` path only. `_textStream` is unchanged — text still streams normally; populating hosted results in the streamed `done` chunk is deferred, see scope.)

- [ ] **Step 4: Run test + typecheck + full suite**

Run: `pnpm exec vitest run lib/clients/anthropic.hostedTools.test.ts && pnpm typecheck && pnpm test`
Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add lib/clients/anthropic.ts lib/clients/anthropic.hostedTools.test.ts
git commit -m "feat(hostedTools): Anthropic web search translate + parse + cost"
```

---

### Task 6: OpenAI Responses — translate + parse + cost

**Files:**
- Modify: `lib/clients/openaiResponses.ts`
- Test: `lib/clients/openaiResponses.hostedTools.test.ts`

**Interfaces:**
- Produces (exported): `openaiResponsesWebSearchEntries(hostedTools?: string[]): any[]`, `parseOpenAIResponsesHostedTools(response: any, provider: string): HostedToolResult[]`.

- [ ] **Step 1: Write the failing test**

Create `lib/clients/openaiResponses.hostedTools.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { openaiResponsesWebSearchEntries, parseOpenAIResponsesHostedTools } from "./openaiResponses.js";

describe("openaiResponsesWebSearchEntries", () => {
  it("emits {type:'web_search'} when requested", () => {
    expect(openaiResponsesWebSearchEntries(["web_search"])).toEqual([{ type: "web_search" }]);
  });
  it("emits nothing otherwise", () => {
    expect(openaiResponsesWebSearchEntries([])).toEqual([]);
  });
});

describe("parseOpenAIResponsesHostedTools", () => {
  it("normalizes web_search_call + url_citation annotations", () => {
    const response = {
      output: [
        { type: "web_search_call", action: { type: "search", query: "ts 6.0" } },
        { type: "message", content: [{ type: "output_text", text: "TS 6.", annotations: [{ type: "url_citation", url: "https://ts.dev/6", title: "TS 6", start_index: 0, end_index: 4 }] }] },
      ],
    };
    const out = parseOpenAIResponsesHostedTools(response, "openai-responses");
    expect(out).toHaveLength(1);
    expect(out[0].queries).toEqual(["ts 6.0"]);
    expect(out[0].callCount).toBe(1);
    expect(out[0].citations?.[0].url).toBe("https://ts.dev/6");
    expect(out[0].sources?.[0].url).toBe("https://ts.dev/6");
  });
  it("returns [] with no web search", () => {
    expect(parseOpenAIResponsesHostedTools({ output: [{ type: "message", content: [] }] }, "openai-responses")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/clients/openaiResponses.hostedTools.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement translation, parsing, and wiring**

In `lib/clients/openaiResponses.ts`, add imports:

```ts
import { WEB_SEARCH, estimateHostedToolCost, foldHostedToolCost } from "../util/hostedTools.js";
import type { HostedToolResult } from "../types.js";
```

Add exported pure functions (module scope):

```ts
export function openaiResponsesWebSearchEntries(hostedTools?: string[]): any[] {
  if (hostedTools && hostedTools.includes(WEB_SEARCH)) {
    return [{ type: "web_search" }];
  }
  return [];
}

export function parseOpenAIResponsesHostedTools(
  response: any,
  provider: string,
): HostedToolResult[] {
  const queries: string[] = [];
  const sources: { url: string; title?: string }[] = [];
  const citations: { url: string; title?: string; startIndex?: number; endIndex?: number }[] = [];
  let callCount = 0;
  for (const item of response.output || []) {
    if (item.type === "web_search_call") {
      callCount += 1;
      const query = item.action?.query;
      if (typeof query === "string") {
        queries.push(query);
      }
    } else if (item.type === "message") {
      for (const part of item.content || []) {
        for (const ann of part.annotations || []) {
          if (ann.type === "url_citation" && typeof ann.url === "string") {
            citations.push({ url: ann.url, title: ann.title, startIndex: ann.start_index, endIndex: ann.end_index });
            sources.push({ url: ann.url, title: ann.title });
          }
        }
      }
    }
  }
  if (callCount === 0 && citations.length === 0) {
    return [];
  }
  const result: HostedToolResult = { tool: WEB_SEARCH, provider };
  if (queries.length > 0) {
    result.queries = queries;
  }
  if (sources.length > 0) {
    result.sources = sources;
  }
  if (citations.length > 0) {
    result.citations = citations;
  }
  if (callCount > 0) {
    result.callCount = callCount;
  }
  return [result];
}
```

Wire translation into `buildRequest` (after the `config.tools` block, ~line 114):

```ts
    const hostedEntries = openaiResponsesWebSearchEntries(config.hostedTools);
    if (hostedEntries.length > 0) {
      const existing = Array.isArray(request.tools) ? request.tools : [];
      request.tools = [...existing, ...hostedEntries];
    }
```

Wire parsing + cost into `_textSync` (replace the `const { usage, cost } = ...; return success({...})` block at ~226-234):

```ts
    const { usage, cost } = this.calculateUsageAndCost(response.usage);
    const hostedToolResults = parseOpenAIResponsesHostedTools(response, "openai-responses");
    for (const r of hostedToolResults) {
      r.estimatedCost = estimateHostedToolCost(r, this.getModel(), this.config.modelData);
    }
    const finalCost = foldHostedToolCost(cost, hostedToolResults);

    return success({
      output,
      toolCalls,
      usage,
      cost: finalCost,
      model: this.getModel(),
      ...(hostedToolResults.length > 0 && { hostedToolResults }),
    });
```

(Streaming: sync-only in v1 — `_textStream` unchanged; see scope.)

- [ ] **Step 4: Run test + typecheck + full suite**

Run: `pnpm exec vitest run lib/clients/openaiResponses.hostedTools.test.ts && pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/clients/openaiResponses.ts lib/clients/openaiResponses.hostedTools.test.ts
git commit -m "feat(hostedTools): OpenAI Responses web search translate + parse + cost"
```

---

### Task 7: Google — translate + parse + cost

**Files:**
- Modify: `lib/clients/google.ts`
- Test: `lib/clients/google.hostedTools.test.ts`

**Interfaces:**
- Produces (exported): `googleWebSearchEntries(hostedTools?: string[]): any[]`, `parseGoogleHostedTools(result: any, provider: string, model: string): HostedToolResult[]`.

- [ ] **Step 1: Write the failing test**

Create `lib/clients/google.hostedTools.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { googleWebSearchEntries, parseGoogleHostedTools } from "./google.js";

describe("googleWebSearchEntries", () => {
  it("emits {googleSearch:{}} when requested", () => {
    expect(googleWebSearchEntries(["web_search"])).toEqual([{ googleSearch: {} }]);
  });
  it("emits nothing otherwise", () => {
    expect(googleWebSearchEntries(undefined)).toEqual([]);
  });
});

describe("parseGoogleHostedTools", () => {
  const result = {
    candidates: [
      {
        groundingMetadata: {
          webSearchQueries: ["ts 6.0", "typescript 6"],
          groundingChunks: [{ web: { uri: "https://ts.dev/6", title: "TS 6" } }],
          groundingSupports: [{ segment: { startIndex: 0, endIndex: 4 }, groundingChunkIndices: [0] }],
        },
      },
    ],
  };
  it("normalizes queries/sources/citations; callCount = #queries on gemini 3", () => {
    const out = parseGoogleHostedTools(result, "google", "gemini-3-pro-preview");
    expect(out[0].queries).toEqual(["ts 6.0", "typescript 6"]);
    expect(out[0].sources?.[0].url).toBe("https://ts.dev/6");
    expect(out[0].citations?.[0].url).toBe("https://ts.dev/6");
    expect(out[0].callCount).toBe(2);
  });
  it("callCount = 1 on gemini 2.5 (billed per prompt)", () => {
    const out = parseGoogleHostedTools(result, "google", "gemini-2.5-flash");
    expect(out[0].callCount).toBe(1);
  });
  it("degrades gracefully when groundingChunks is missing", () => {
    const r = { candidates: [{ groundingMetadata: { webSearchQueries: ["x"] } }] };
    const out = parseGoogleHostedTools(r, "google", "gemini-3-pro-preview");
    expect(out[0].queries).toEqual(["x"]);
    expect(out[0].sources).toBeUndefined();
  });
  it("returns [] without grounding", () => {
    expect(parseGoogleHostedTools({ candidates: [{}] }, "google", "gemini-3-pro-preview")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/clients/google.hostedTools.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement translation, parsing, and wiring**

In `lib/clients/google.ts`, add imports:

```ts
import { WEB_SEARCH, estimateHostedToolCost, foldHostedToolCost } from "../util/hostedTools.js";
import type { HostedToolResult } from "../types.js";
```

Add exported pure functions:

```ts
export function googleWebSearchEntries(hostedTools?: string[]): any[] {
  if (hostedTools && hostedTools.includes(WEB_SEARCH)) {
    return [{ googleSearch: {} }];
  }
  return [];
}

export function parseGoogleHostedTools(
  result: any,
  provider: string,
  model: string,
): HostedToolResult[] {
  const queries: string[] = [];
  const sources: { url: string; title?: string }[] = [];
  const citations: { url: string; title?: string; startIndex?: number; endIndex?: number }[] = [];
  for (const candidate of result.candidates || []) {
    const gm = candidate.groundingMetadata;
    if (!gm) {
      continue;
    }
    for (const q of gm.webSearchQueries || []) {
      queries.push(q);
    }
    const chunks = gm.groundingChunks || [];
    for (const c of chunks) {
      if (c.web && typeof c.web.uri === "string") {
        sources.push({ url: c.web.uri, title: c.web.title });
      }
    }
    for (const s of gm.groundingSupports || []) {
      for (const idx of s.groundingChunkIndices || []) {
        const chunk = chunks[idx];
        if (chunk && chunk.web && typeof chunk.web.uri === "string") {
          citations.push({
            url: chunk.web.uri,
            title: chunk.web.title,
            startIndex: s.segment?.startIndex,
            endIndex: s.segment?.endIndex,
          });
        }
      }
    }
  }
  if (queries.length === 0 && sources.length === 0) {
    return [];
  }
  // Gemini 2.5 bills per prompt (1), Gemini 3+ per query.
  let callCount = queries.length;
  if (model.startsWith("gemini-2.5")) {
    callCount = 1;
  }
  const out: HostedToolResult = { tool: WEB_SEARCH, provider, callCount };
  if (queries.length > 0) {
    out.queries = queries;
  }
  if (sources.length > 0) {
    out.sources = sources;
  }
  if (citations.length > 0) {
    out.citations = citations;
  }
  return [out];
}
```

Wire translation into `buildRequest` (extend the tools block ~100-114):

```ts
    const hostedEntries = googleWebSearchEntries(config.hostedTools);
    if (tools.length > 0 || hostedEntries.length > 0) {
      const toolGroups: any[] = [];
      if (tools.length > 0) {
        toolGroups.push({ functionDeclarations: tools });
      }
      for (const entry of hostedEntries) {
        toolGroups.push(entry);
      }
      genConfig.tools = toolGroups;
    }
```

(Replace the existing `if (tools.length > 0) { genConfig.tools = [{ functionDeclarations: tools }]; }`.)

Wire parsing + cost into `__textSync` result assembly (replace the `const { usage, cost } = ...; return success({...})` block at ~322-332):

```ts
    const { usage, cost } = this.calculateUsageAndCost(result.usageMetadata);
    const hostedToolResults = parseGoogleHostedTools(result, "google", request.model as string);
    for (const r of hostedToolResults) {
      r.estimatedCost = estimateHostedToolCost(r, request.model as string, this.config.modelData);
    }
    const finalCost = foldHostedToolCost(cost, hostedToolResults);

    return success({
      output,
      toolCalls,
      ...(thinkingBlocks.length > 0 && { thinkingBlocks }),
      usage,
      cost: finalCost,
      model: request.model as ModelName,
      ...(hostedToolResults.length > 0 && { hostedToolResults }),
    });
```

Note: Google disables `responseFormat` when tools are present (existing behavior). Hosted web search counts as a tool, so structured output + web search in one call is not supported — acceptable for v1; document in the README task.

- [ ] **Step 4: Run test + typecheck + full suite**

Run: `pnpm exec vitest run lib/clients/google.hostedTools.test.ts && pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/clients/google.ts lib/clients/google.hostedTools.test.ts
git commit -m "feat(hostedTools): Google web search translate + parse + cost"
```

---

### Task 8: Exports + README + full gate

**Files:**
- Modify: `README.md`
- Test: full suite

**Interfaces:**
- New type names (`HostedToolResult`, `WebSearchSource`, `WebSearchCitation`) are exported via the existing `export * from "./types.js"` in `lib/index.ts` — confirm, no change expected.

- [ ] **Step 1: Full gate**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: all green. Fix any pre-existing test that referenced the old `CostEstimate`/`PromptResult` shape (additive changes, so none expected).

- [ ] **Step 2: Confirm exports**

Run: `node --input-type=module -e "import * as s from './dist/index.js'; console.log(typeof s.promptResult);"`
Expected: `function` (types are erased at runtime; this just confirms the entrypoint builds and imports).

- [ ] **Step 3: Write the docs**

Add to `README.md`, right after the "Hosted tools catalog" section:

````markdown
### Using a hosted tool

Enable a provider's hosted web search on a call with `hostedTools` (a list of
capability names). It's separate from `tools` because hosted tools run
server-side — you can't intercept or gate them like your own functions.

```ts
import { textSync } from "smoltalk";

const result = await textSync({
  model: "claude-opus-4-8",
  messages,
  hostedTools: ["web_search"],
});

// Normalized across providers, regardless of who ran the search:
console.log(result.value?.hostedToolResults);
// [{ tool: "web_search", provider: "anthropic", queries: [...], sources: [...],
//    citations: [...], callCount: 1, estimatedCost: 0.01 }]
```

Supported on Anthropic, Google, and OpenAI (Responses-API models, e.g. the
GPT-5 family). It is **not** available on chat-only OpenAI models (e.g. `gpt-4o`)
or local models — those return a clear error; use a search *function* (e.g. the
Brave/Tavily-backed tools) as a regular `tool` instead. `estimatedCost` is an
upper-bound estimate (providers report usage counts, not charges; free-tier
allowances are ignored). On Google, web search can't be combined with structured
output in the same call.
````

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document hosted-tool web search usage"
```

---

## Notes on scope

- **In:** `config.hostedTools`, catalog-driven validation, per-provider web-search translation + normalized result parsing + estimated cost, OpenAI→`openai-responses` catalog fix, docs.
- **Out (deferred):** other hosted tools; Brave/Tavily (Agency-side client tools); `tool_choice`/forcing; per-hour/per-gb-day cost; billing-API reconciliation; per-delta streaming citations.
- **Capability key = catalog `category`** (so `"web_search"` maps to Google's `google_search`). This refines the spec's "canonical name" wording.
- **Streaming (v1): sync-only.** `hostedToolResults` are populated on the `textSync` path only. Streaming text is unaffected and validation still runs in `textStream`, but the streamed `done` chunk does not include `hostedToolResults` in v1 (streamed accumulators differ from the sync response shape). Deferred — and this refines the spec, which had said streaming would carry them.
