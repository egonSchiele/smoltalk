# Design: Hosted-tools runtime (web search)

Date: 2026-06-28
Status: Approved (pending spec review)

## Goal

Let a smoltalk caller **enable a provider hosted tool** on an LLM call and get
**normalized results back**. v1 implements **web search** across the providers
that support it natively (Anthropic, Google, OpenAI Responses). This is the
runtime counterpart to the hosted-tools *catalog* already shipped.

Primary consumer: Agency. An Agency `llm()` call exposes hosted capabilities as a
bare-string `capabilities: ["web_search"]` array (distinct from `tools`, because
hosted tools can't be intercepted/permission-gated/counted like Agency
functions). That maps 1:1 onto smoltalk's `config.hostedTools: ["web_search"]`.
External search (Brave/Tavily) is *not* part of this — in Agency those are stdlib
functions passed as ordinary `tools`; smoltalk only owns the hosted path.

## What hosted tools are (and aren't)

A hosted tool runs **server-side inside one generation call** — the caller
authorizes it and is billed; the provider runs the whole search→read→synthesize
loop. The caller cannot intercept it mid-flight (no permission gate, no per-call
counter). smoltalk's job is therefore **enable + observe**: switch the capability
on, and surface what the provider reports (queries, sources, citations, usage
count, an estimated cost). It is not "intercept + control".

## Scope

**In:**
- `SmolConfig.hostedTools?: string[]` (bare canonical names; v1 handles `web_search`).
- Per-provider request translation for web search (Anthropic, Google, OpenAI Responses).
- Catalog-driven validation (unsupported provider/model → `Failure`).
- Normalized `HostedToolResult` in `PromptResult` (queries / sources / citations / callCount / estimatedCost / raw), parsed per provider.
- Estimated cost for web search (per-call) via the existing `hostedToolPricingFor`.
- Catalog reconciliation: OpenAI hosted tools → provider `openai-responses`.

**Out (deferred):**
- Other hosted tools (code execution, file search, image generation, url context, maps).
- The Brave/Tavily client-tool path (Agency composition, not smoltalk).
- Forcing tools / `tool_choice`.
- Authoritative spend via providers' org-level billing APIs.
- Per-delta citations during streaming (results land in the final result only).

## Decisions (from brainstorming)

1. **Enable via a bare-string list** `config.hostedTools: ["web_search"]` — extensible, maps to Agency's `capabilities`.
2. **Hosted ≠ tools.** Kept separate from `config.tools` because they behave fundamentally differently (no interception/permission/counting).
3. **Normalize results across providers**, with a `raw` escape hatch for provider specifics. Agency won't surface these to users yet, but smoltalk returns them now.
4. **Cost is an estimate** computed from returned usage counts × catalog price (providers return usage primitives, never a charged dollar amount in the response). Clean for web search because it is priced per-call; free-tier allowances are stateful and ignored, so the figure is an upper bound.
5. **v1 = web search only**, on anthropic / google / openai-responses.

## 1. Enable API (`lib/types.ts`)

```ts
// SmolConfig
/** Provider hosted tools (server-side) to enable for this call, by canonical
 *  catalog name, e.g. ["web_search"]. Distinct from `tools` (client functions)
 *  — hosted tools run server-side and can't be intercepted. */
hostedTools?: string[];
```

Flows through `getClient`/`functions.ts` unchanged (config is spread through), like
`tools` does today.

## 2. Validation (catalog-driven)

Before dispatch, validate each requested name against the catalog for the
resolved model. A shared helper (so all clients behave identically):

```ts
// lib/util/hostedTools.ts
// Returns an error message if any requested hosted tool is unsupported for this
// model, else null. Uses getHostedTools({ model, modelData }).
function validateHostedTools(
  requested: string[],
  model: string,
  modelData?: ModelDataBlob,
): string | null;
```

Rules:
- Unknown name (not in catalog at all) → error: `"Unknown hosted tool \"x\"."`
- Known but not available for this model/provider (e.g. local model, or
  `openai` chat model) → error naming the model and suggesting a client tool:
  `"web_search is a hosted capability; <model> (<provider>) doesn't offer it — pass a search function as a tool instead."`

Clients call this at the top of `_textSync`/`_textStream` and return
`failure(message)` (the Result convention) on a non-null result. Validation lives
in one helper; clients just call it.

## 3. Per-provider request translation

Each client maps a supported canonical name to its native tool config while
building the request (alongside the existing `config.tools` conversion). v1 only
maps `web_search`:

- **Anthropic** (`lib/clients/anthropic.ts`): append to `tools`:
  `{ type: "web_search_20250305", name: "web_search" }`.
- **OpenAI Responses** (`lib/clients/openaiResponses.ts`): append to `request.tools`:
  `{ type: "web_search" }`.
- **Google** (`lib/clients/google.ts`): add to `genConfig.tools`:
  `{ googleSearch: {} }`.

A small per-client mapping function keeps the "what" (which capability) separate
from the "how" (provider tool shape):

```ts
// returns the provider-native tool entries for the requested hosted tools
function hostedToolRequestEntries(requested: string[]): ProviderToolEntry[]
```

Unsupported-but-requested names never reach here (validation already failed).
`openai` (chat) and `ollama` clients do not implement translation — validation
rejects hosted tools there.

## 4. Normalized results (`lib/types.ts` + per-client parsing)

New types:

```ts
export type WebSearchSource = {
  url: string;
  title?: string;
  snippet?: string;
};

export type WebSearchCitation = {
  url: string;
  title?: string;
  startIndex?: number; // offsets into PromptResult.output when the provider gives them
  endIndex?: number;
};

export type HostedToolResult = {
  tool: string;                  // canonical name, e.g. "web_search"
  provider: string;
  queries?: string[];            // search queries the model issued
  sources?: WebSearchSource[];   // sources surfaced
  citations?: WebSearchCitation[]; // sources tied to output text spans
  callCount?: number;            // number of searches/requests performed
  estimatedCost?: number;        // USD, callCount x catalog price; undefined if not derivable
  raw?: unknown;                 // provider payload, unnormalized (escape hatch)
};
```

`PromptResult` gains `hostedToolResults?: HostedToolResult[]` (and
`promptResult(...)` passes it through). Per-provider parsing:

- **Anthropic:** `server_tool_use` blocks → `queries`; `web_search_tool_result`
  blocks → `sources`; text-block `citations` → `citations`;
  `usage.server_tool_use.web_search_requests` → `callCount`.
- **OpenAI Responses:** `web_search_call` items (`action`) → `queries` +
  `callCount`; `url_citation` annotations on the message → `citations` (and
  `sources` from their url/title).
- **Google:** `groundingMetadata.webSearchQueries` → `queries`;
  `groundingChunks` → `sources`; `groundingSupports` → `citations`;
  `callCount` from `webSearchQueries.length` (per-query providers) — for Gemini
  2.5 (billed per prompt) use `1` when grounded.

Each client builds at most one `HostedToolResult` per tool used and attaches
`raw` (the provider's unnormalized payload) so nothing is lost. Streaming: parsed
into the final `done` result; deltas are unaffected.

## 5. Cost estimate

Reuse the catalog: `estimatedCost = callCount × hostedToolPricingFor(tool, model).amount`
when the resolved pricing `unit` is `per_call` (web search). A shared helper:

```ts
// lib/util/hostedTools.ts
function estimateHostedToolCost(
  result: HostedToolResult,
  model: string,
  modelData?: ModelDataBlob,
): number | undefined; // undefined when unit isn't per-call/per-query
```

The dollar amount is also folded into `PromptResult.cost`: add
`hostedToolsCost?: number` to `CostEstimate` (sum of per-result `estimatedCost`)
and include it in `totalCost`. It is explicitly an estimate (ignores stateful
free-tier allowances; providers return counts, not charges).

## 6. Components & boundaries

- `lib/util/hostedTools.ts` (new): `validateHostedTools`, `estimateHostedToolCost`,
  and the `web_search` canonical-name constant. One home for the shared "what".
- Each client: a small `hostedToolRequestEntries` (translation) + a
  `parseHostedToolResults(response)` (normalization). Provider-specific "how".
- `lib/types.ts`: the new types + `SmolConfig.hostedTools` + `PromptResult.hostedToolResults` + `CostEstimate.hostedToolsCost`.
- `lib/models.ts` / catalog: move OpenAI hosted tools to provider `openai-responses`; regenerate `data/model-data.json`.

Boundary check: a caller enables a capability by name and reads a normalized
result; they never touch provider tool shapes. Adding a future hosted tool means
adding a catalog entry + per-client translation/parse — not changing the public
surface.

## 7. Error handling

- Unsupported/unknown hosted tool → `Failure` before any API call (§2).
- Provider returns no tool activity (model chose not to search) →
  `hostedToolResults` omitted/empty; not an error.
- Parsing is defensive: a missing/renamed provider field (e.g. Gemini dropping
  `groundingChunks`) degrades to fewer normalized fields, never throws; `raw`
  still carries whatever came back.

## 8. Testing

- **Validation:** supported model passes; local/ollama and `openai`-chat models
  → failure with the right message; unknown name → failure.
- **Translation:** each client adds the correct native entry for `web_search`
  alongside existing `config.tools` (assert on the built request via the
  injected/mocked SDK or request builder).
- **Result parsing:** feed a representative provider response fixture to each
  client's parser → expected normalized `HostedToolResult` (queries/sources/
  citations/callCount), and `raw` preserved. Include a Gemini fixture missing
  `groundingChunks` (degrades gracefully).
- **Cost:** `estimateHostedToolCost` = count × price; per-model override applied
  (Gemini 2.5 vs 3); `CostEstimate.hostedToolsCost` summed into `totalCost`;
  `undefined` for a non-per-call unit.
- **Catalog:** OpenAI hosted tools now under `openai-responses`; `getHostedTools({ model: "gpt-5" })` includes `web_search`; `getHostedTools({ model: "gpt-4o" })` does not.
- No live network in unit tests (use fixtures / injected SDK responses, per existing client test patterns).

## 9. File-by-file

- `lib/types.ts` — `hostedTools` on `SmolConfig`; `WebSearchSource`/`WebSearchCitation`/`HostedToolResult`; `hostedToolResults` on `PromptResult`; `hostedToolsCost` on `CostEstimate`; thread through `promptResult(...)`.
- `lib/util/hostedTools.ts` (new) — validation, cost estimate, canonical-name constant.
- `lib/clients/anthropic.ts`, `lib/clients/openaiResponses.ts`, `lib/clients/google.ts` — translation + result parsing + cost wiring.
- `lib/models.ts` — OpenAI hosted tools → `openai-responses` provider.
- `data/model-data.json` — regenerate (`pnpm refresh-data`).
- `lib/index.ts` — exports already via `export *`; confirm new type names exported.
- README — short "Using hosted tools" note.
- Tests alongside each module.

## Out of scope (YAGNI)

- Code execution / file search / image generation / url context / maps runtime.
- Brave/Tavily (Agency-side client tools).
- Forcing a tool / `tool_choice`.
- Reconciling authoritative spend via providers' org-level cost APIs.
- Per-hour / per-gb-day cost estimation (no per-response quantity exists; `estimatedCost` stays `undefined` for those).
