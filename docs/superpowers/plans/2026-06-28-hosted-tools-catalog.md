# Hosted-tools Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give smoltalk a structured, refreshable catalog of provider hosted tools (web search, code execution, file search, image generation) with pricing, surfaced via `getHostedTools()`. Data only — no runtime invocation.

**Architecture:** Enrich the existing `HostedTool` type with structured pricing + per-model overrides, populate a baked-in catalog for Anthropic/OpenAI/Google, and add filtering + a pricing resolver to `getHostedTools`. The refresh/registration/merge machinery is unchanged — `hostedTools` already round-trips in the blob; only validation and the catalog data change.

**Tech Stack:** TypeScript (ESNext, `nodenext`, `strict`), zod v4, vitest.

## Global Constraints

- **ES Modules:** every internal import uses a `.js` extension.
- **No ternaries or conditional spreads:** use explicit `if` statements (user preference).
- **zod is v4:** use `.catchall(z.unknown())` for permissive objects; `z.prettifyError(err)` for messages.
- **Result type:** fallible parsing returns `Result<T>` from `lib/types/result.js` (already in place for `parseModelDataBlob`).
- **Strict TypeScript:** `pnpm typecheck` must stay green. NOTE: `*.test.ts` is excluded from tsconfig, so type-only mistakes in tests are NOT caught by typecheck — verify test behavior via vitest.
- **Tests:** live in `lib/` as `*.test.ts`; run with `pnpm exec vitest run <file>`. Full suite: `pnpm test`. Types: `pnpm typecheck`. Build: `pnpm build`.
- **Catalog distribution:** `hostedTools` already flows through the refresh blob (baked-in ◁ registered ◁ per-call) via `mergeHostedTools`; the seed script serializes it, so `data/model-data.json` regenerates with `pnpm seed-data`.
- All paths are relative to `packages/smoltalk/` unless noted.

---

### Task 1: Enrich the `HostedTool` data model + schema

**Files:**
- Modify: `lib/modelData.ts:9-17` (`HostedTool` type), `lib/modelData.ts:42-52` (`HostedToolSchema`)
- Modify: `lib/models.ts:1575-1582` (the one baked `hostedTools` entry — convert to new shape so `pnpm typecheck` stays green)
- Test: `lib/modelData.hostedTools.test.ts`

**Interfaces:**
- Produces:
  - `type HostedToolPricing = { unit: "per_call"|"per_session"|"per_hour"|"per_gb_day"|"tokens"|"free"; amount?: number; freeAllowance?: string; note?: string; perModel?: Record<string, Partial<HostedToolPricing>> }`
  - `type HostedTool = { name: string; provider: string; category?: string; description?: string; providerToolId?: string; models?: string[]; pricing?: HostedToolPricing; disabled?: boolean }`

- [ ] **Step 1: Write the failing test**

Create `lib/modelData.hostedTools.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseModelDataBlob } from "./modelData.js";

const tool = {
  name: "google_search",
  provider: "google",
  category: "web_search",
  providerToolId: "google_search",
  pricing: {
    unit: "per_call",
    amount: 0.014,
    freeAllowance: "5,000/month (Gemini 3)",
    note: "billed per query",
    perModel: { "gemini-2.5-pro": { amount: 0.035, note: "billed per prompt" } },
  },
};

describe("HostedToolSchema (via parseModelDataBlob)", () => {
  it("accepts a hosted tool with structured pricing + perModel", () => {
    const raw = JSON.stringify({ schemaVersion: 1, generatedAt: "x", models: [], hostedTools: [tool] });
    const result = parseModelDataBlob(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      const t = result.value.hostedTools[0];
      expect(t.category).toBe("web_search");
      expect(t.pricing?.unit).toBe("per_call");
      expect(t.pricing?.perModel?.["gemini-2.5-pro"]?.amount).toBe(0.035);
    }
  });

  it("skips a hosted tool missing required fields but keeps good ones", () => {
    const raw = JSON.stringify({ schemaVersion: 1, generatedAt: "x", models: [], hostedTools: [tool, { provider: "openai" }] });
    const result = parseModelDataBlob(raw);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.hostedTools).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/modelData.hostedTools.test.ts`
Expected: FAIL — `perModel` is dropped (current schema has no `pricing`/`perModel`), so `t.pricing?.perModel?.["gemini-2.5-pro"]?.amount` is `undefined`, not `0.035`.

- [ ] **Step 3: Write minimal implementation**

In `lib/modelData.ts`, replace the `HostedTool` type (lines 9-17) with:

```ts
export type HostedToolPricing = {
  unit: "per_call" | "per_session" | "per_hour" | "per_gb_day" | "tokens" | "free";
  amount?: number;        // USD per unit; omitted for free / token-based
  freeAllowance?: string; // human note of a free tier, e.g. "50 container-hours/day"
  note?: string;          // long-tail nuance (tiers, "+ content tokens", context-size)
  // Per-model overrides, merged over the base pricing (base field <- override field).
  perModel?: Record<string, Partial<HostedToolPricing>>;
};

export type HostedTool = {
  name: string;             // smoltalk canonical name, e.g. "web_search"
  provider: string;         // "anthropic" | "openai" | "google"
  category?: string;        // cross-provider grouping, e.g. "web_search" | "code_execution"
  description?: string;
  providerToolId?: string;  // the provider's real tool id, e.g. "web_search_preview"
  models?: string[];        // optional allowlist; omitted = all of provider's models
  pricing?: HostedToolPricing;
  disabled?: boolean;
};
```

In `lib/modelData.ts`, replace `HostedToolSchema` (lines 42-52) with:

```ts
const HostedToolPricingSchema = z
  .object({
    unit: z.string(),
    amount: z.number().optional(),
    freeAllowance: z.string().optional(),
    note: z.string().optional(),
    perModel: z.record(z.string(), z.unknown()).optional(),
  })
  .catchall(z.unknown());

const HostedToolSchema = z
  .object({
    name: z.string(),
    provider: z.string(),
    category: z.string().optional(),
    description: z.string().optional(),
    providerToolId: z.string().optional(),
    models: z.array(z.string()).optional(),
    pricing: HostedToolPricingSchema.optional(),
    disabled: z.boolean().optional(),
  })
  .catchall(z.unknown());
```

In `lib/models.ts`, replace the baked `hostedTools` const (lines 1575-1582) with the new shape (full catalog comes in Task 3 — this just keeps typecheck green):

```ts
export const hostedTools: HostedTool[] = [
  {
    name: "web_search",
    provider: "anthropic",
    category: "web_search",
    description: "Anthropic server-side web search tool.",
    providerToolId: "web_search",
    pricing: { unit: "per_call", amount: 0.01, note: "$10 per 1,000 searches, plus content tokens." },
  },
];
```

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run: `pnpm exec vitest run lib/modelData.hostedTools.test.ts && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/modelData.ts lib/models.ts lib/modelData.hostedTools.test.ts
git commit -m "feat(hostedTools): structured pricing + richer HostedTool type"
```

---

### Task 2: `getHostedTools` filtering + `hostedToolPricingFor`

**Files:**
- Modify: `lib/models.ts:1630-1640` (`getHostedTools`), and the `HostedTool` import near line 6
- Test: `lib/models.hostedTools.test.ts`

**Interfaces:**
- Consumes: `HostedTool`, `HostedToolPricing` (Task 1); `getModel`, `mergeHostedTools`, `registeredModelData`, `hostedTools`.
- Produces:
  - `getHostedTools(opts?: { provider?: string; model?: string; category?: string; includeDisabled?: boolean; modelData?: ModelDataBlob }): HostedTool[]`
  - `hostedToolPricingFor(tool: HostedTool, model?: string): HostedToolPricing | undefined`

- [ ] **Step 1: Write the failing test**

Create `lib/models.hostedTools.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getHostedTools, hostedToolPricingFor } from "./models.js";
import type { ModelDataBlob } from "./modelData.js";

// Synthetic overlay passed per-call so tests don't depend on the baked catalog.
const blob: ModelDataBlob = {
  schemaVersion: 1,
  generatedAt: "x",
  models: [],
  hostedTools: [
    { name: "google_search", provider: "google", category: "web_search", pricing: { unit: "per_call", amount: 0.014, perModel: { "gemini-2.5-flash": { amount: 0.035 } } } },
    { name: "maps_grounding", provider: "google", category: "maps_grounding", models: ["gemini-3-pro-preview"], pricing: { unit: "per_call" } },
    { name: "old_tool", provider: "google", category: "web_search", disabled: true, pricing: { unit: "free" } },
  ] as any,
};

describe("getHostedTools filtering", () => {
  it("filters by provider", () => {
    const names = getHostedTools({ provider: "google", modelData: blob }).map((t) => t.name);
    expect(names).toContain("google_search");
    expect(names).not.toContain("web_search"); // anthropic baked tool excluded
  });

  it("filters by category", () => {
    const names = getHostedTools({ category: "maps_grounding", modelData: blob }).map((t) => t.name);
    expect(names).toEqual(["maps_grounding"]);
  });

  it("excludes disabled tools by default, includes them on request", () => {
    expect(getHostedTools({ modelData: blob }).map((t) => t.name)).not.toContain("old_tool");
    expect(getHostedTools({ includeDisabled: true, modelData: blob }).map((t) => t.name)).toContain("old_tool");
  });

  it("filters by model: provider match + models allowlist", () => {
    // gemini-2.5-flash is a baked google model; maps_grounding is Gemini-3-only -> excluded.
    const names = getHostedTools({ model: "gemini-2.5-flash", modelData: blob }).map((t) => t.name);
    expect(names).toContain("google_search");
    expect(names).not.toContain("maps_grounding");
  });

  it("returns a fresh array (no baseline mutation)", () => {
    const a = getHostedTools();
    a.push({ name: "x", provider: "y" } as any);
    expect(getHostedTools().map((t) => t.name)).not.toContain("x");
  });
});

describe("hostedToolPricingFor", () => {
  it("returns base pricing with perModel stripped", () => {
    const tool = { name: "google_search", provider: "google", pricing: { unit: "per_call", amount: 0.014, perModel: { "gemini-2.5-flash": { amount: 0.035 } } } } as any;
    const p = hostedToolPricingFor(tool);
    expect(p?.amount).toBe(0.014);
    expect(p?.perModel).toBeUndefined();
  });

  it("merges the per-model override over the base", () => {
    const tool = { name: "google_search", provider: "google", pricing: { unit: "per_call", amount: 0.014, perModel: { "gemini-2.5-flash": { amount: 0.035, note: "per prompt" } } } } as any;
    const p = hostedToolPricingFor(tool, "gemini-2.5-flash");
    expect(p?.amount).toBe(0.035);
    expect(p?.note).toBe("per prompt");
    expect(p?.unit).toBe("per_call");
    expect(p?.perModel).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/models.hostedTools.test.ts`
Expected: FAIL — `hostedToolPricingFor` is not exported; `getHostedTools` doesn't accept a filter object.

- [ ] **Step 3: Write minimal implementation**

In `lib/models.ts`, update the import near line 6 to include `HostedToolPricing`:

```ts
import {
  mergeModelData,
  mergeHostedTools,
  type ModelDataBlob,
  type HostedTool,
  type HostedToolPricing,
} from "./modelData.js";
```

Replace `getHostedTools` (lines 1630-1640) with:

```ts
export function getHostedTools(opts: {
  provider?: string;
  model?: string;
  category?: string;
  includeDisabled?: boolean;
  modelData?: ModelDataBlob;
} = {}): HostedTool[] {
  // Start from a copy so callers can never mutate the baseline registry.
  let tools = [...hostedTools];
  if (registeredModelData) {
    tools = mergeHostedTools(tools, registeredModelData.hostedTools);
  }
  if (opts.modelData) {
    tools = mergeHostedTools(tools, opts.modelData.hostedTools);
  }

  let modelProvider: string | undefined;
  if (opts.model) {
    modelProvider = getModel(opts.model, opts.modelData)?.provider;
  }

  return tools.filter((tool) => {
    if (tool.disabled && !opts.includeDisabled) {
      return false;
    }
    if (opts.provider && tool.provider !== opts.provider) {
      return false;
    }
    if (opts.category && tool.category !== opts.category) {
      return false;
    }
    if (opts.model) {
      if (tool.provider !== modelProvider) {
        return false;
      }
      if (tool.models && !tool.models.includes(opts.model)) {
        return false;
      }
    }
    return true;
  });
}

export function hostedToolPricingFor(
  tool: HostedTool,
  model?: string,
): HostedToolPricing | undefined {
  if (!tool.pricing) {
    return undefined;
  }
  // Strip perModel from the base; merge the override for `model` when present.
  const { perModel, ...base } = tool.pricing;
  if (model && perModel && perModel[model]) {
    return { ...base, ...perModel[model] };
  }
  return base;
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm exec vitest run lib/models.hostedTools.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/models.ts lib/models.hostedTools.test.ts
git commit -m "feat(hostedTools): filtering options + per-model pricing resolver"
```

---

### Task 3: Populate the baked-in catalog + regenerate artifact

**Files:**
- Modify: `lib/models.ts` (`hostedTools` const — expand to full catalog)
- Modify: `lib/models.register.test.ts` (the "merges hosted tools" test asserts the removed `costPerCall`; update to new shape)
- Modify: `data/model-data.json` (regenerated)
- Test: add a catalog-sanity test to `lib/models.hostedTools.test.ts`

**Interfaces:**
- Consumes: `HostedTool` (Task 1), `getHostedTools` (Task 2).

- [ ] **Step 1: Write the failing test**

Append to `lib/models.hostedTools.test.ts`:

```ts
import { hostedTools } from "./models.js";

describe("baked-in hosted-tool catalog", () => {
  it("covers the three cloud providers with valid entries", () => {
    const providers = new Set(hostedTools.map((t) => t.provider));
    expect(providers.has("anthropic")).toBe(true);
    expect(providers.has("openai")).toBe(true);
    expect(providers.has("google")).toBe(true);
  });

  it("every entry has a known unit and no duplicate (provider, name)", () => {
    const UNITS = new Set(["per_call", "per_session", "per_hour", "per_gb_day", "tokens", "free"]);
    const seen = new Set<string>();
    for (const t of hostedTools) {
      expect(t.pricing?.unit, t.name).toBeDefined();
      expect(UNITS.has(t.pricing!.unit), `${t.name} unit`).toBe(true);
      const key = `${t.provider}:${t.name}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });

  it("maps_grounding is gated to the Gemini 3 family", () => {
    const maps = hostedTools.find((t) => t.name === "maps_grounding");
    expect(maps?.models?.length).toBeGreaterThan(0);
    expect(maps?.models?.every((m) => m.startsWith("gemini-3"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/models.hostedTools.test.ts`
Expected: FAIL — only `anthropic` is present (catalog has the single web_search entry); `maps_grounding` not found.

- [ ] **Step 3: Write minimal implementation**

In `lib/models.ts`, replace the `hostedTools` const with the full catalog (prices USD, best-effort as of 2026-06, refreshable):

```ts
export const hostedTools: HostedTool[] = [
  {
    name: "web_search",
    provider: "anthropic",
    category: "web_search",
    description: "Server-side web search with citations.",
    providerToolId: "web_search",
    pricing: { unit: "per_call", amount: 0.01, note: "$10 per 1,000 searches, plus content tokens." },
  },
  {
    name: "web_fetch",
    provider: "anthropic",
    category: "url_context",
    description: "Fetch and read a specific URL.",
    providerToolId: "web_fetch",
    pricing: { unit: "free", note: "No extra charge beyond tokens." },
  },
  {
    name: "code_execution",
    provider: "anthropic",
    category: "code_execution",
    description: "Run code in a sandboxed container.",
    providerToolId: "code_execution",
    pricing: { unit: "per_hour", amount: 0.05, freeAllowance: "50 container-hours/day", note: "Free when used with web_search or web_fetch." },
  },
  {
    name: "web_search",
    provider: "openai",
    category: "web_search",
    description: "Server-side web search (Responses API).",
    providerToolId: "web_search",
    pricing: { unit: "per_call", amount: 0.01, note: "$10/1k standard; $25/1k preview non-reasoning; plus ~8k input tokens per call. Varies by search_context_size." },
  },
  {
    name: "file_search",
    provider: "openai",
    category: "file_search",
    description: "Semantic + keyword search over uploaded files.",
    providerToolId: "file_search",
    pricing: { unit: "per_call", amount: 0.0025, note: "$2.50 per 1,000 calls, plus $0.10/GB-day vector storage." },
  },
  {
    name: "code_interpreter",
    provider: "openai",
    category: "code_execution",
    description: "Run Python in a sandboxed container.",
    providerToolId: "code_interpreter",
    pricing: { unit: "per_session", amount: 0.03, note: "Per container session." },
  },
  {
    name: "image_generation",
    provider: "openai",
    category: "image_generation",
    description: "Generate images with gpt-image-1 as a tool.",
    providerToolId: "image_generation",
    pricing: { unit: "tokens", note: "gpt-image-1 token pricing: $5/$10/$40 per 1M text-in/image-in/image-out." },
  },
  {
    name: "google_search",
    provider: "google",
    category: "web_search",
    description: "Grounding with Google Search.",
    providerToolId: "google_search",
    pricing: {
      unit: "per_call",
      amount: 0.014,
      freeAllowance: "5,000 grounded prompts/month (Gemini 3)",
      note: "Billed per query; a request may issue multiple queries.",
      perModel: {
        "gemini-2.5-pro": { amount: 0.035, freeAllowance: "1,500/day shared", note: "Billed per prompt (Gemini 2.5)." },
        "gemini-2.5-flash": { amount: 0.035, freeAllowance: "1,500/day shared", note: "Billed per prompt (Gemini 2.5)." },
        "gemini-2.5-flash-lite": { amount: 0.035, freeAllowance: "1,500/day shared", note: "Billed per prompt (Gemini 2.5)." },
      },
    },
  },
  {
    name: "code_execution",
    provider: "google",
    category: "code_execution",
    description: "Run Python generated by the model.",
    providerToolId: "code_execution",
    pricing: { unit: "tokens", note: "Billed as tokens; no separate tool fee." },
  },
  {
    name: "url_context",
    provider: "google",
    category: "url_context",
    description: "Ground responses on specific URLs you provide.",
    providerToolId: "url_context",
    pricing: { unit: "tokens", note: "Tokens only." },
  },
  {
    name: "maps_grounding",
    provider: "google",
    category: "maps_grounding",
    description: "Grounding with Google Maps (Gemini 3 only).",
    providerToolId: "google_maps",
    models: ["gemini-3-pro-preview", "gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-3.5-flash", "gemini-3.1-flash-lite"],
    pricing: { unit: "per_call", note: "Gemini 3 family only; see Google pricing." },
  },
];
```

In `lib/models.register.test.ts`, find the test `"merges hosted tools from baseline, global, and request layers"` and replace its body's overlay + assertion to use the new pricing shape:

```ts
  it("merges hosted tools from baseline, global, and request layers", () => {
    registerModelData({ schemaVersion: 1, generatedAt: "x", models: [], hostedTools: [{ name: "web_search", provider: "anthropic", pricing: { unit: "per_call", amount: 0.02 } } as any] });
    const tools = getHostedTools();
    const ws = tools.find((t) => t.name === "web_search");
    expect(ws?.pricing?.amount).toBe(0.02); // global overlay wins over baseline
  });
```

- [ ] **Step 4: Run tests + typecheck + regenerate artifact**

Run: `pnpm exec vitest run lib/models.hostedTools.test.ts lib/models.register.test.ts && pnpm typecheck`
Expected: PASS.

Then regenerate the published artifact. Use `refresh-data` (NOT `seed-data`):
`seed-data` serializes baseline consts only and would drop the models.dev model
enrichment already published on `main`. `refresh-data` re-merges baseline +
models.dev *and* picks up the new `hostedTools` catalog (its `buildSeedBlob`
baseline now includes it).

Run: `pnpm refresh-data`
Expected: writes `data/model-data.json` with the enriched models + new catalog.

Verify both landed in the artifact:

Run: `node -e "const b=require('./data/model-data.json'); console.log('models:', b.models.length, '| hostedTools:', b.hostedTools.length, '| tool providers:', [...new Set(b.hostedTools.map(t=>t.provider))].join(','))"`
Expected: `models: 103 | hostedTools: 11 | tool providers: anthropic,openai,google`

- [ ] **Step 5: Commit**

```bash
git add lib/models.ts lib/models.register.test.ts lib/models.hostedTools.test.ts data/model-data.json
git commit -m "feat(hostedTools): populate baked-in catalog for anthropic/openai/google"
```

---

### Task 4: Run full suite + document

**Files:**
- Modify: `README.md`
- Test: full suite

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Run the full suite + build (no failing test to write — this is the integration gate)**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: all green. If any pre-existing test referenced the old `HostedTool` shape, fix it to the new shape.

- [ ] **Step 2: Write the docs**

Add to `README.md`, immediately after the "Refreshing model data" section:

````markdown
## Hosted tools catalog

Each cloud provider offers server-side "hosted" tools (web search, code
execution, file search, image generation). Smoltalk ships a catalog of what's
available and what it costs — query it with `getHostedTools()`:

```ts
import { getHostedTools, hostedToolPricingFor } from "smoltalk";

// All hosted tools usable with a given model (respects provider + model allowlists):
const tools = getHostedTools({ model: "claude-opus-4-8" });

// All web-search tools across providers:
const search = getHostedTools({ category: "web_search" });

// Effective pricing for a tool on a specific model (applies per-model overrides):
const price = hostedToolPricingFor(search[0], "gemini-2.5-pro");
```

The catalog rides in the same refresh blob as model data, so `refreshModels()`
keeps it current. It's informational (catalog/pricing only) — smoltalk does not
yet invoke hosted tools on your behalf. Local models (Ollama) have none.
````

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document the hosted-tools catalog"
```

---

## Notes on scope

- **In:** richer `HostedTool`/`HostedToolPricing` types, schema validation, `getHostedTools` filtering, `hostedToolPricingFor`, the baked-in catalog, regenerated artifact, docs.
- **Out (deferred, per spec):** runtime invocation (passing hosted tools to provider APIs / parsing results); structured `search_context_size` tiers (kept in `pricing.note`); auto-deriving catalog content from an upstream (none exists — distribution via the refresh blob already works).
- The catalog prices are best-effort and refreshable; the README and entries say so.
