# Design: Hosted-tools catalog

Date: 2026-06-28
Status: Approved (pending spec review)

## Goal

Give smoltalk a structured, refreshable **catalog** of provider hosted tools
(server-side tools like web search, code execution, file search, image
generation) — what each provider offers, which models support it, and what it
costs — surfaced through `getHostedTools()`. This is **data only**: it does not
make smoltalk invoke hosted tools.

The plumbing already exists from the model-data-refresh work: a `HostedTool`
type, a `hostedTools` baked-in const, `getHostedTools()`, `mergeHostedTools()`,
and `hostedTools` carried in the refresh blob (baked-in ◁ global ◁ per-call).
This design **enriches the data model**, **populates the catalog**, and **adds
query ergonomics** — it does not change the refresh/registration/merge machinery.

## Scope

**In:** richer `HostedTool` / `HostedToolPricing` types; a populated baked-in
catalog for Anthropic, OpenAI, Google; filtering in `getHostedTools()`; a
pricing resolver; schema validation for the new shape; regenerated
`data/model-data.json`.

**Out (deferred):** runtime invocation — enabling a hosted tool on a `text()`
call, translating it to each provider's API, and parsing results/citations back.
The catalog is *designed to support* that later (via `providerToolId` /
`category`) without committing to it now.

Local models (Ollama) have no hosted tools.

## Decisions (from brainstorming)

1. **Catalog/data only**, not runtime invocation.
2. **Structured pricing** with a `unit` discriminator + amount + note, because
   provider pricing units are wildly inconsistent (per-search, per-session,
   per-hour, per-GB-day, token-based, free).
3. **Provider-level association with an optional `models` allowlist** — a tool
   belongs to a provider; `models` narrows it where needed (e.g. Maps grounding
   is Gemini-3-only). Omitted `models` = all of that provider's models.
4. **Optional per-model price overrides** — e.g. Google Search grounding is
   `$14/1k` on Gemini 3 but `$35/1k` on Gemini 2.5.
5. **Hand-maintained** — no upstream exposes a machine-readable hosted-tool
   pricing catalog (not models.dev, LiteLLM, or OpenRouter), so the catalog ships
   baked-in and flows through the refresh blob like model data.

### Ecosystem validation (research)

LiteLLM and OpenRouter both confirm the modeling: each unifies hosted tools
around a **canonical tool name/category** mapping to provider specifics
(OpenRouter's `openrouter:web_search`), and each keeps a **which-models-support-it**
list. OpenRouter additionally shows web-search pricing is frequently **tiered by
`search_context_size`** (low/medium/high) — captured here in `pricing.note`
rather than a dedicated structured axis (consistent with decision 2).

## 1. Data model (`lib/modelData.ts`)

The current placeholder `HostedTool` (`{ name, provider, description?, costPerCall?,
inputTokenCost?, outputTokenCost?, disabled? }`) is **redefined** — it is new and
barely used (one seed entry), so no backwards compatibility is required.

```ts
export type HostedToolPricing = {
  unit: "per_call" | "per_session" | "per_hour" | "per_gb_day" | "tokens" | "free";
  amount?: number;        // USD per unit; omitted for free / token-based
  freeAllowance?: string; // human note of a free tier, e.g. "50 container-hours/day"
  note?: string;          // long-tail nuance (tiers, "+ content tokens", context-size)
  // Per-model overrides, merged over the base pricing (base ◁ override per field).
  perModel?: Record<string, Partial<HostedToolPricing>>;
};

export type HostedTool = {
  name: string;             // smoltalk canonical name, e.g. "web_search"
  provider: string;         // "anthropic" | "openai" | "google"
  category?: string;        // cross-provider grouping (see below)
  description?: string;
  providerToolId?: string;  // the provider's real tool id, e.g. "web_search_preview"
  models?: string[];        // optional allowlist; omitted = all of provider's models
  pricing?: HostedToolPricing;
  disabled?: boolean;
};
```

`category` is a free-string with conventional values: `web_search`,
`code_execution`, `file_search`, `image_generation`, `url_context`,
`maps_grounding`, `computer_use`. It enables cross-provider queries ("all
web-search tools"). `providerToolId` records the real API id (documentation now,
forward-compat for a future runtime layer). `perModel` is keyed by exact
`modelName`; a `Partial<HostedToolPricing>` is merged field-by-field over the
base (the same precedence idea as model merges).

## 2. Query API (`lib/models.ts`)

`getHostedTools` gains an options bag (replacing the current
`getHostedTools(requestData?)` — new, so the signature change is free):

```ts
export function getHostedTools(opts?: {
  provider?: string;
  model?: string;       // resolves the model's provider via getModel, then matches `models` allowlist
  category?: string;
  includeDisabled?: boolean; // default false
  modelData?: ModelDataBlob; // per-call overlay, same as elsewhere
}): HostedTool[];
```

Resolution: start from the merged catalog (baked-in ◁ registered ◁
`opts.modelData`, via the existing `mergeHostedTools`), then filter:
- `provider` → exact match.
- `model` → resolve provider via `getModel(model, modelData)`; keep tools whose
  `provider` matches AND (`models` absent OR `models` includes the model).
- `category` → exact match.
- disabled tools excluded unless `includeDisabled`.
- Returns a fresh array (never the baked-in const — caller can't mutate baseline).

A pricing resolver for the per-model overrides:

```ts
// Effective pricing for a tool given a specific model (base ◁ perModel[model]).
export function hostedToolPricingFor(
  tool: HostedTool,
  model?: string,
): HostedToolPricing | undefined;
```

Returns `tool.pricing` with `perModel[model]` merged over it when `model` is
given and an override exists; `perModel` itself is stripped from the result.

## 3. Refresh / registration integration

No changes to `refreshModels`, `registerModelData`, `clearModelData`, or
`mergeHostedTools` — `blob.hostedTools` already round-trips and merges. The only
change in `parseModelDataBlob` is updating `HostedToolSchema` to validate the new
shape (permissive, `.catchall(z.unknown())`), dropping the old
`costPerCall`/`inputTokenCost`/`outputTokenCost` fields and validating nested
`pricing` / `pricing.perModel`. Entry-level validation still skips bad entries
with a warning. The seed script already serializes `hostedTools`, so
`data/model-data.json` regenerates from the new const automatically.

## 4. Baked-in catalog contents (`lib/models.ts`)

Replace the single `web_search` seed with the researched catalog. Prices are USD
and best-effort as of 2026-06; they are maintained and refreshable. Representative
entries (the plan pins exact values):

| name | provider | category | pricing (unit, amount, notes) |
|---|---|---|---|
| `web_search` | anthropic | web_search | per_call $0.01 ("+ content tokens") |
| `web_fetch` | anthropic | url_context | free ("tokens only") |
| `code_execution` | anthropic | code_execution | per_hour $0.05, freeAllowance "50 container-hours/day" ("free with web_search/fetch") |
| `web_search` | openai | web_search | per_call $0.01 ("standard; $25/1k preview non-reasoning; + ~8k input tokens/call") |
| `file_search` | openai | file_search | per_call $0.0025 ("+ $0.10/GB-day vector storage") |
| `code_interpreter` | openai | code_execution | per_session $0.03 |
| `image_generation` | openai | image_generation | tokens ("gpt-image-1: $5/$10/$40 per 1M text-in/image-in/image-out") |
| `google_search` | google | web_search | per_call $0.014, freeAllowance "5,000/mo (Gemini 3)"; perModel gemini-2.5-* → $0.035 ("per prompt, 1,500/day") |
| `code_execution` | google | code_execution | tokens ("billed as tokens; no separate fee") |
| `url_context` | google | url_context | tokens ("tokens only") |
| `maps_grounding` | google | maps_grounding | per_call, `models`: Gemini-3 family only |

`models` allowlists for native-web-search coverage are sanity-checked against
OpenRouter's published per-provider list.

## 5. Testing

- `HostedToolSchema` validation: well-formed entry with structured pricing +
  `perModel`; bad entry skipped-with-warning; round-trip through
  `parseModelDataBlob`.
- `getHostedTools` filtering: by `provider`, by `category`, by `model` (provider
  match + `models` allowlist, incl. a Gemini-3-only tool excluded for a 2.5
  model), `includeDisabled`, and returns-a-copy (no baseline mutation).
- `hostedToolPricingFor`: base passthrough; per-model override merged; `perModel`
  stripped from result.
- Catalog sanity: every baked-in tool has a known `provider` and a `pricing.unit`;
  no duplicate `(provider, name)`.
- Layering: a registered/per-call `hostedTools` overlay wins over baked-in
  (already covered by existing merge tests; add one for the enriched shape).

## File-by-file changes

- `lib/modelData.ts` — redefine `HostedTool`, add `HostedToolPricing`; update
  `HostedToolSchema` for the new shape (incl. nested `pricing`/`perModel`).
- `lib/models.ts` — populate the `hostedTools` catalog; rewrite `getHostedTools`
  with the options/filter; add `hostedToolPricingFor`.
- `lib/index.ts` — already re-exports both modules; confirm new names are exported.
- `data/model-data.json` — regenerated via `pnpm seed-data` (or `refresh-data`).
- Tests: `lib/models.hostedTools.test.ts` (filtering + pricing resolver),
  `lib/modelData.hostedTools.test.ts` (schema), catalog sanity in either.
- `README.md` — short "Hosted tools catalog" note documenting `getHostedTools`.

## Out of scope (YAGNI)

- Runtime invocation / passing hosted tools to provider APIs / parsing results.
- Structured `search_context_size` pricing tiers (captured in `note`).
- Auto-*deriving* the catalog content from a third-party upstream — no source
  publishes hosted-tool pricing (not models.dev/LiteLLM/OpenRouter), so the
  catalog *content* is hand-maintained. (Note: *distribution* is not out of
  scope — the catalog ships in the refresh blob and updates via `refreshModels()`
  like model data; the CI job preserves `hostedTools` in `data/model-data.json`.)
- Cumulative free-tier accounting (allowances are stateful across requests; the
  catalog records them as informational notes, not a usage meter).
