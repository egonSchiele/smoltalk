# smoltalk Hosted OpenAI-Compatible Providers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four built-in providers to smoltalk — `openrouter`, `deepinfra`, `litellm`, and a generic `openai-compat` — so callers can run hosted open-source models with accurate per-request cost, preceded by a breaking refactor that nests all API keys/base URLs under `apiKey`/`baseUrl` maps.

**Architecture:** All four services are OpenAI-compatible, so they reuse smoltalk's existing `SmolOpenAi` client; we add two override seams to `SmolOpenAi` (how the OpenAI SDK client is built, and how cost is read) and subclass it once per provider. Per-provider classes bake in base URLs (where fixed) and the provider-specific way to read cost (`usage.cost`, `usage.cost_usd` / `usage.estimated_cost`, or the `x-litellm-response-cost` header).

**Tech Stack:** TypeScript, the `openai` npm SDK, `zod` (for `ProviderSchema`/`ModelNameSchema`), **vitest** (confirmed: existing tests use it; live tests use the `.live.test.ts` suffix convention), GitHub Actions for CI.

**Repo layout (confirmed):** pnpm workspace monorepo. The core package lives at `packages/smoltalk/`; sources are under `packages/smoltalk/lib/` (NOT `src/`). Tests are siblings of the file under test (`foo.ts` ↔ `foo.test.ts`). Live/integration tests use the `.live.test.ts` suffix (see `clients/openai.live.test.ts`, `clients/google.live.test.ts`, `clients/anthropic.live.test.ts`).

**Source spec:** `docs/superpowers/specs/2026-06-29-smoltalk-hosted-providers-design.md` (in the agency-lang repo). This plan is executed in the **smoltalk** repo.

## Why in-tree (not plugins) and why a breaking change

Both questions came up; the answers are deliberate:

- **In-tree, not plugin packages.** UX: users install one package (`smoltalk`) and switch providers by changing a `provider:` string. Forcing them to install `smoltalk-openrouter`, `smoltalk-deepinfra`, etc. for what are all OpenAI-compatible REST calls is friction with no payoff. (The plugin path is reserved for providers that need a heavy dependency, like `smoltalk-llama-cpp` and `smoltalk-webllm`.)
- **Breaking the config shape now.** Adding the four new keys to a flat `SmolConfig` would push the type past the point where it's mostly about API keys. Smoltalk has very few users today — this is the cheapest moment to clean it up. Bump the major version, add a migration note to the README, move on.

## Global Constraints

- **Target repo is `smoltalk`** (pnpm monorepo); core package = `packages/smoltalk`, sources under `packages/smoltalk/lib/`.
- **This is a BREAKING release.** Task 1 removes the flat `*ApiKey` config fields **and** the flat `ollamaHost` field (the latter migrates into `config.baseUrl.ollama` for consistency). Bump `packages/smoltalk/package.json` to a new major version as part of Task 1. A lockstep agency-lang update is a separate follow-up (out of scope here).
- **Config shape:** keys live under `config.apiKey.<name>`, custom URLs under `config.baseUrl.<name>`, both camelCase: `openAi`, `google`, `anthropic`, `ollama`, `openRouter`, `deepInfra`, `liteLlm`, `openAiCompat`. Yes, `baseUrl.ollama` (where the local Ollama server lives) lives in the same map as `baseUrl.openRouter` etc.
- **Env-var fallbacks:** `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OLLAMA_HOST` (existing), `OPENROUTER_API_KEY`, `DEEPINFRA_API_KEY`, `LITELLM_API_KEY`, `OPENAI_COMPAT_API_KEY`, `OPENAI_COMPAT_BASE_URL`, `LITELLM_BASE_URL`.
- **Baked base URLs:** openrouter `https://openrouter.ai/api/v1`; deepinfra `https://api.deepinfra.com/v1/openai`. Overridable via `config.baseUrl.openRouter` / `config.baseUrl.deepInfra`. `litellm` and `openai-compat` base URLs are **required from config/env** (no default).
- **Provider names (kebab) used in `provider:`** are `openrouter`, `deepinfra`, `litellm`, `openai-compat`. They intentionally differ from the camelCase config-map keys (kebab is conventional for `provider:` strings; camelCase is conventional for JS object keys).
- **Cost shape:** `CostEstimate` is `{ inputCost: number; outputCost: number; totalCost: number; currency: string; hostedToolsCost?: number }` (see `lib/types/costEstimate.ts`). When a provider returns only a single total (e.g. OpenRouter `usage.cost`), set `inputCost: 0`, `outputCost: 0`, `totalCost: <amount>`, `currency: "USD"`.
- **OpenRouter cost requires opt-in.** OpenRouter only returns `usage.cost` when the request body includes `usage: { include: true }`. `SmolOpenRouter` MUST inject this by default (see Task 5). Same applies to streaming: the SDK must send `stream_options: { include_usage: true }` for the final chunk to carry usage (smoltalk likely already does — verify in Task 0).
- **DeepInfra cost field.** DeepInfra's OpenAI-compatible chat completions return `usage.estimated_cost` (USD). Verify with the live test in Task 8 before trusting it.
- **Structured output reuses** `SmolOpenAi`'s existing `response_format: { type: "json_schema", json_schema: { name, schema } }` — do not change it.
- **LiteLLM cost is non-streaming only** (the `x-litellm-response-cost` header is absent while streaming).
- **Callers must pass an explicit `provider`** for these (model names aren't in smoltalk's model registry).
- **Follow smoltalk's existing conventions** (lint, file layout, test style). The code blocks below are concrete but illustrative — align signatures/imports with the real source.

---

## Task 0: Recon the smoltalk repo (no code change)

**Files:** none modified. Record findings in the PR description / a scratch note.

Most of the recon was done while writing this plan (locations are noted inline below). This task confirms the remaining unknowns. **Do not skip — Tasks 2, 5, 7 depend on these answers.**

Confirmed sources (already verified):
- `packages/smoltalk/lib/clients/openai.ts` — `class SmolOpenAi extends BaseClient` (constructor at L37; `private calculateUsageAndCost` at L55)
- `packages/smoltalk/lib/clients/baseClient.ts` — `BaseClient`
- `packages/smoltalk/lib/client.ts` — `getClient` + `registerProvider`
- `packages/smoltalk/lib/util/provider.ts` — `resolveProvider`, `resolveApiKey` (currently typed against `ApiKeyConfig`, not `SmolConfig`)
- `packages/smoltalk/lib/models.ts` — `providers` array (L9), `ProviderSchema` (L18), `ModelNameSchema` (L1806)
- `packages/smoltalk/lib/types.ts` — `SmolConfig` (L15), `CostEstimate` re-export
- `packages/smoltalk/lib/types/costEstimate.ts` — `CostEstimate` shape (`inputCost`, `outputCost`, `totalCost`, `currency`, optional `hostedToolsCost`)
- `packages/smoltalk/lib/embed.ts` — `EmbedConfig` with its own flat `openAiApiKey`/`googleApiKey`/`ollamaApiKey`/`ollamaHost`
- `packages/smoltalk/lib/image.ts` — `ImageConfig` with its own flat `openAiApiKey`/`googleApiKey`
- Live test convention: `*.live.test.ts` files (e.g. `clients/openai.live.test.ts`), gated by `process.env.<PROVIDER>_API_KEY` so they no-op locally

- [ ] **Step 1: Confirm runtime/contract details the later tasks need**
  - Test command: `pnpm test` (workspace root) or `pnpm --filter smoltalk test`. Confirm how `openai.live.test.ts` decides whether to run (look for env-gating pattern); reuse it for new live tests.
  - In `SmolOpenAi`, locate the **method that performs the completion call** (`this.client.chat.completions.create(...)`). Confirm separate streaming vs non-streaming paths (already verified at L184 non-stream, L230 stream). Record the exact method name(s) so Task 2 Step 5 knows where to add `.withResponse()`.
  - Confirm whether smoltalk's non-stream request already sets `stream_options: { include_usage: true }` for the stream path (needed so OpenRouter/DeepInfra emit `usage` in the final streamed chunk).
  - Confirm the public structured-output API: `textSync(prompt, { responseFormat: <ZodSchema> })` from `lib/functions.ts` (verify; used in Task 8 live tests).
  - Note: `OLLAMA_HOST` env-var fallback handling — Task 1 will migrate `config.ollamaHost` → `config.baseUrl.ollama`; confirm whether the existing Ollama client already reads `process.env.OLLAMA_HOST` so we preserve that behavior.

- [ ] **Step 2: Confirm the test baseline is green**

Run `pnpm test` from the workspace root once and confirm it passes before changing anything.

No commit (recon only).

---

## Task 1: BREAKING — nest API keys/base URLs under `apiKey`/`baseUrl`

**Files:**
- Modify: `packages/smoltalk/lib/types.ts` (`SmolConfig`)
- Modify: `packages/smoltalk/lib/embed.ts` (`EmbedConfig`)
- Modify: `packages/smoltalk/lib/image.ts` (`ImageConfig`)
- Modify: `packages/smoltalk/lib/util/provider.ts` (`resolveApiKey`: change signature from `ApiKeyConfig` to a small local type that mirrors the new nested shape; do **not** import `SmolConfig` here to avoid a circular import)
- Modify: every client reading a flat key — `packages/smoltalk/lib/clients/openai.ts`, `openaiResponses.ts`, `google.ts`, `anthropic.ts`, `ollama.ts`
- Modify: `packages/smoltalk/lib/embed/openai.ts`, `embed/google.ts`, `embed/ollama.ts`, `image/openai.ts`, `image/google.ts` (any place that reads a flat field)
- Modify: `packages/smoltalk/lib/client.ts` (any `resolvedKeys`/direct flat reads in `getClient`)
- Modify: `packages/smoltalk/package.json` — bump major version
- Modify: `README.md`, `CLAUDE.md`, any docs/examples that reference the flat fields
- Test: `packages/smoltalk/lib/util/provider.test.ts` and the existing client test files

**Interfaces:**
- Produces:
  - `SmolConfig.apiKey?: { openAi?, google?, anthropic?, ollama?, openRouter?, deepInfra?, liteLlm?, openAiCompat? }`
  - `SmolConfig.baseUrl?: { ollama?, openRouter?, deepInfra?, liteLlm?, openAiCompat? }` (note: `baseUrl.ollama` replaces the old flat `ollamaHost`)
  - Same `apiKey`/`baseUrl` nested types on `EmbedConfig` and `ImageConfig`
  - `resolveApiKey(provider, config)` reads `config.apiKey?.<name>` with env fallback

- [ ] **Step 1: Write/adjust the failing test for `resolveApiKey`**

Edit `packages/smoltalk/lib/util/provider.test.ts`:

```ts
import { resolveApiKey } from "./provider.js";

it("reads keys from the nested apiKey map", () => {
  expect(resolveApiKey("openai", { apiKey: { openAi: "sk-1" } })).toBe("sk-1");
  expect(resolveApiKey("anthropic", { apiKey: { anthropic: "an-1" } })).toBe("an-1");
});

it("falls back to env vars", () => {
  const prev = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "env-1";
  expect(resolveApiKey("openai", {})).toBe("env-1");
  process.env.OPENAI_API_KEY = prev;
});

it("no longer reads the old flat fields", () => {
  // @ts-expect-error flat field removed from the type
  expect(resolveApiKey("openai", { openAiApiKey: "sk-old" })).toBeUndefined();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter smoltalk test -- provider.test.ts`
Expected: FAIL (resolveApiKey still reads flat `openAiApiKey`).

- [ ] **Step 3: Update `SmolConfig`**

In `packages/smoltalk/lib/types.ts`, remove `openAiApiKey`, `googleApiKey`, `anthropicApiKey`, `ollamaApiKey`, **and** `ollamaHost`. Add:

```ts
apiKey?: {
  openAi?: string;
  google?: string;
  anthropic?: string;
  ollama?: string;
  openRouter?: string;
  deepInfra?: string;
  liteLlm?: string;
  openAiCompat?: string;
};
baseUrl?: {
  ollama?: string;       // replaces the old flat ollamaHost
  openRouter?: string;
  deepInfra?: string;
  liteLlm?: string;
  openAiCompat?: string;
};
```

Mirror the same `apiKey`/`baseUrl` fields in `EmbedConfig` (only the keys/URLs the embed router needs: `openAi`, `google`, `ollama`, `deepInfra`, `liteLlm`, `openAiCompat`, plus `baseUrl.ollama`/`deepInfra`/`liteLlm`/`openAiCompat`) and `ImageConfig` (only `openAi`, `google`, `liteLlm`, `openAiCompat`).

- [ ] **Step 4: Rewrite `resolveApiKey`**

In `packages/smoltalk/lib/util/provider.ts`, replace the `ApiKeyConfig` local type with one that matches the new nested shape (kept local to avoid a circular import of `SmolConfig`):

```ts
type NestedKeyConfig = {
  apiKey?: {
    openAi?: string;
    google?: string;
    anthropic?: string;
    ollama?: string;
    openRouter?: string;
    deepInfra?: string;
    liteLlm?: string;
    openAiCompat?: string;
  };
};

export function resolveApiKey(provider: string, config: NestedKeyConfig): string | undefined {
  const k = config.apiKey;
  switch (provider) {
    case "openai":
    case "openai-responses":
      return k?.openAi || process.env.OPENAI_API_KEY;
    case "google":
      return k?.google || process.env.GEMINI_API_KEY;
    case "anthropic":
      return k?.anthropic || process.env.ANTHROPIC_API_KEY;
    case "ollama":
      return k?.ollama;
    default:
      return undefined;
  }
}
```

(The four new providers are added to this switch in Task 7.)

- [ ] **Step 5: Update each client + the `resolvedKeys` block + Ollama host**

In each client constructor, change the flat read to the nested one, e.g. in `SmolOpenAi`:

```ts
// before: new OpenAI({ apiKey: config.openAiApiKey })
this.client = new OpenAI({ apiKey: config.apiKey?.openAi });
```

Do the equivalent for `SmolGoogle`, `SmolAnthropic`, `SmolOpenAiResponses`. For `SmolOllama` migrate **both** the key and the host:
- `config.apiKey?.ollama` (was `config.ollamaApiKey`)
- `config.baseUrl?.ollama || process.env.OLLAMA_HOST` (was `config.ollamaHost`). Preserve the env-var fallback verbatim.

In `getClient`, update any `resolvedKeys`/direct flat reads to the nested shape.

Do the same in `embed/openai.ts`, `embed/google.ts`, `embed/ollama.ts`, `image/openai.ts`, `image/google.ts` for their respective keys, and in the `embed.ts`/`image.ts` routers that pass `config.ollamaHost` → switch to `config.baseUrl?.ollama || process.env.OLLAMA_HOST`.

(Task 2 replaces `SmolOpenAi`'s constructor line again via `resolveClientOptions`; doing the simple swap here keeps this task's build green.)

- [ ] **Step 6: Fix all other call sites, fixtures, and docs**

```bash
rg -n 'openAiApiKey|googleApiKey|anthropicApiKey|ollamaApiKey|ollamaHost' packages README.md CLAUDE.md
```

Update each hit to the nested shape. Update README/docs examples and the CLAUDE.md "Adding a New Provider" walkthrough. Add a **short migration note** to the README explaining the rename (one before/after snippet).

- [ ] **Step 7: Bump the smoltalk package version**

Edit `packages/smoltalk/package.json` — increment the major version (this is a SemVer-breaking change).

- [ ] **Step 8: Run the new tests + full suite**

Run: `pnpm test` (workspace root)
Expected: PASS (new resolveApiKey tests green; no regressions).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor!: nest API keys/base URLs under config.apiKey/config.baseUrl

BREAKING CHANGE: flat openAiApiKey/googleApiKey/anthropicApiKey/ollamaApiKey/
ollamaHost config fields are removed; use config.apiKey.{openAi,google,
anthropic,ollama} and config.baseUrl.ollama. Adds config.baseUrl map for
custom provider URLs. Env-var fallbacks unchanged (including OLLAMA_HOST).
Major version bump."
```

---

## Task 2: Add the two override seams to `SmolOpenAi` (behavior-preserving)

**Files:**
- Modify: `packages/smoltalk/lib/clients/openai.ts` (`SmolOpenAi`)
- Test: `packages/smoltalk/lib/clients/openai.test.ts`

**Interfaces:**
- Produces (for Tasks 4–6 to override):
  - `protected resolveClientOptions(config): { apiKey?: string; baseURL?: string }`
  - `protected resolveCostUsd(usage: any, rawResponse?: Response): number | undefined`
  - `calculateUsageAndCost(usageData, rawResponse?)` is changed from `private` → `protected`, takes an optional `rawResponse`, and consults `resolveCostUsd` first, then falls back to `this.model.calculateCost(usage)`.

- [ ] **Step 1: Write the failing test (the seams are exercised by a subclass)**

In `packages/smoltalk/lib/clients/openai.test.ts`:

```ts
import { SmolOpenAi } from "./openai.js";

class FakeProvider extends SmolOpenAi {
  protected resolveClientOptions() { return { apiKey: "k", baseURL: "https://example.test/v1" }; }
  protected resolveCostUsd(usage: any) {
    return typeof usage?.cost === "number" ? usage.cost : undefined;
  }
}

it("uses resolveClientOptions for baseURL", () => {
  const c = new FakeProvider({ model: "gpt-4o", provider: "openai" });
  expect((c as any).client.baseURL).toContain("example.test");
});

it("prefers resolveCostUsd over the registry cost", () => {
  const c = new FakeProvider({ model: "gpt-4o", provider: "openai" });
  const { usage, cost } = (c as any).calculateUsageAndCost({ prompt_tokens: 100, completion_tokens: 50, cost: 0.5 });
  expect(cost?.totalCost).toBe(0.5);
  expect(cost?.currency).toBe("USD");
  expect(usage?.inputTokens).toBe(100);
});

it("falls back to registry cost when resolveCostUsd returns undefined", () => {
  const c = new FakeProvider({ model: "gpt-4o", provider: "openai" });
  const { cost } = (c as any).calculateUsageAndCost({ prompt_tokens: 100, completion_tokens: 50 }); // no cost field
  expect(cost?.totalCost).toBeGreaterThan(0); // computed from gpt-4o pricing
});
```

(The `(c as any)` cast is intentional — `calculateUsageAndCost` is `protected`, so we reach into it for the unit test only.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter smoltalk test -- openai.test.ts`
Expected: FAIL (`resolveClientOptions`/`resolveCostUsd` don't exist; cost not overridable; method is still `private`).

- [ ] **Step 3: Add `resolveClientOptions` and use it in the constructor**

```ts
protected resolveClientOptions(config: SmolConfig): { apiKey?: string; baseURL?: string } {
  const apiKey = config.apiKey?.openAi || process.env.OPENAI_API_KEY;
  // Don't throw if missing — preserve existing SmolOpenAi behavior (the SDK
  // will throw at request time). Subclasses with required keys do their own check.
  return { apiKey };
}
```

In the constructor, replace the `new OpenAI({...})` line with:

```ts
this.client = new OpenAI(this.resolveClientOptions(config));
```

- [ ] **Step 4: Promote `calculateUsageAndCost` to `protected` and wire in `resolveCostUsd`**

Change the method signature from `private calculateUsageAndCost(usageData: any)` to:

```ts
protected calculateUsageAndCost(usageData: any, rawResponse?: Response): { usage: TokenUsage; cost: CostEstimate | undefined }
```

Add the default seam (returns `undefined` so the registry path runs):

```ts
protected resolveCostUsd(_usage: any, _rawResponse?: Response): number | undefined {
  return undefined;
}
```

Inside `calculateUsageAndCost`, after computing `usage`, replace the cost computation with:

```ts
let cost: CostEstimate | undefined;
const providerCost = this.resolveCostUsd(usageData, rawResponse);
if (typeof providerCost === "number") {
  cost = {
    inputCost: 0,
    outputCost: 0,
    totalCost: providerCost,
    currency: "USD",
  };
} else {
  const calculatedCost = this.model.calculateCost(usage);
  if (calculatedCost) cost = calculatedCost;
}
```

Also promote `this.model` from `private` → `protected` if subclasses end up needing it (they don't today, but check the resulting code).

- [ ] **Step 5: Thread the raw response into the non-streaming path**

In the non-streaming completion call (currently at `openai.ts` L~184), capture the raw HTTP response and pass it through:

```ts
// before: const completion = await this.client.chat.completions.create(request);
const { data: completion, response } = await this.client.chat.completions.create(request).withResponse();
// ...when computing usage/cost:
const { usage, cost } = this.calculateUsageAndCost(completion.usage, response);
```

In the streaming path (L~230), leave the flow unchanged and call `calculateUsageAndCost(chunk.usage)` with no second arg (header-based cost unsupported while streaming; body-based cost — OpenRouter/DeepInfra — still works because it comes through `chunk.usage`). Parsed-body behavior is unchanged for callers.

If Task 0 found that the stream request does not already set `stream_options: { include_usage: true }`, add it here (in `_textStream`) so the final chunk carries `usage`.

- [ ] **Step 6: Run the new tests + the existing SmolOpenAi tests**

Run: `pnpm --filter smoltalk test -- clients/openai`
Expected: PASS (new seam tests green; existing OpenAI tests still green — behavior preserved).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: add resolveClientOptions + resolveCostUsd seams to SmolOpenAi"
```

---

## Task 3: Widen `ModelNameSchema` to allow `/` and `@`

**Files:**
- Modify: `packages/smoltalk/lib/models.ts` (`ModelNameSchema`, L1806)
- Test: a new file `packages/smoltalk/lib/models.schema.test.ts` (or extend the closest existing models test if one tests the schema)

**Interfaces:**
- Produces: `ModelNameSchema` accepts model IDs containing `/` and `@`.

- [ ] **Step 1: Read the current regex and existing model-name fields**

Before changing the regex, `rg -n 'ModelNameSchema' packages/smoltalk/lib` and confirm the current pattern. Make sure widening doesn't disable any other validation (e.g. `disabled` is a separate field — independent).

- [ ] **Step 2: Write the failing test**

```ts
import { ModelNameSchema } from "./models.js";

it("accepts slashed and @-versioned model ids", () => {
  expect(ModelNameSchema.safeParse("z-ai/glm-5.2").success).toBe(true);
  expect(ModelNameSchema.safeParse("accounts/fireworks/models/glm-x").success).toBe(true);
  expect(ModelNameSchema.safeParse("vendor/model@1.2").success).toBe(true);
});

it("still rejects clearly-malformed names", () => {
  expect(ModelNameSchema.safeParse("bad name!").success).toBe(false);
  expect(ModelNameSchema.safeParse("a b").success).toBe(false);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter smoltalk test -- models.schema`
Expected: FAIL on the slashed ids (`/` not allowed).

- [ ] **Step 4: Widen the regex**

```ts
export const ModelNameSchema = z
  .string()
  .regex(
    /^[a-zA-Z0-9._:@/-]+$/,
    "Model name must only contain letters, numbers, dots, underscores, hyphens, colons, slashes, and @",
  );
```

(`-` is last in the class so it's a literal; `/` inside a `/.../` literal is fine in a character class but escape it as `\/` if the repo's lint requires.)

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm --filter smoltalk test -- models.schema`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix: allow / and @ in ModelNameSchema for hosted provider model ids"
```

---

## Task 4: `SmolOpenAiCompat` — generic OpenAI-compatible client

**Files:**
- Create: `packages/smoltalk/lib/clients/openaiCompat.ts`
- Test: `packages/smoltalk/lib/clients/openaiCompat.test.ts`

**Interfaces:**
- Consumes: `SmolOpenAi` seams (Task 2); widened `ModelNameSchema` (Task 3).
- Produces: `export class SmolOpenAiCompat extends SmolOpenAi`, overriding `resolveClientOptions` (compat key + required URL) and `resolveCostUsd` (body `cost`/`estimated_cost`/`cost_usd`).

- [ ] **Step 1: Write the failing test**

```ts
import { SmolOpenAiCompat } from "./openaiCompat.js";

const base = { model: "some/model", provider: "openai-compat" as const };

it("uses the supplied base URL and key", () => {
  const c = new SmolOpenAiCompat({ ...base, apiKey: { openAiCompat: "k" }, baseUrl: { openAiCompat: "https://host.test/v1" } });
  expect((c as any).client.baseURL).toContain("host.test");
});

it("throws a clear error when base URL is missing", () => {
  expect(() => new SmolOpenAiCompat({ ...base, apiKey: { openAiCompat: "k" } }))
    .toThrow(/base URL/i);
});

it("throws a clear error when key is missing", () => {
  expect(() => new SmolOpenAiCompat({ ...base, baseUrl: { openAiCompat: "https://host.test/v1" } }))
    .toThrow(/API key/i);
});

it("reads cost from usage.cost, usage.estimated_cost, or usage.cost_usd", () => {
  const c = new SmolOpenAiCompat({ ...base, apiKey: { openAiCompat: "k" }, baseUrl: { openAiCompat: "https://host.test/v1" } });
  expect((c as any).calculateUsageAndCost({ prompt_tokens: 1, completion_tokens: 1, cost: 0.01 }).cost?.totalCost).toBe(0.01);
  expect((c as any).calculateUsageAndCost({ prompt_tokens: 1, completion_tokens: 1, estimated_cost: 0.02 }).cost?.totalCost).toBe(0.02);
  expect((c as any).calculateUsageAndCost({ prompt_tokens: 1, completion_tokens: 1, cost_usd: 0.03 }).cost?.totalCost).toBe(0.03);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter smoltalk test -- openaiCompat`
Expected: FAIL (module/class does not exist).

- [ ] **Step 3: Implement `SmolOpenAiCompat`**

```ts
import { SmolOpenAi } from "./openai.js";
import type { SmolConfig } from "../types.js";

export class SmolOpenAiCompat extends SmolOpenAi {
  protected resolveClientOptions(config: SmolConfig): { apiKey: string; baseURL: string } {
    const apiKey = config.apiKey?.openAiCompat || process.env.OPENAI_COMPAT_API_KEY;
    const baseURL = config.baseUrl?.openAiCompat || process.env.OPENAI_COMPAT_BASE_URL;
    if (!apiKey) throw new Error("openai-compat: API key required (config.apiKey.openAiCompat or OPENAI_COMPAT_API_KEY).");
    if (!baseURL) throw new Error("openai-compat: base URL required (config.baseUrl.openAiCompat or OPENAI_COMPAT_BASE_URL).");
    return { apiKey, baseURL };
  }

  protected resolveCostUsd(usage: any): number | undefined {
    // Try the three common conventions across OpenAI-compatible providers.
    const c = usage?.cost ?? usage?.estimated_cost ?? usage?.cost_usd;
    return typeof c === "number" ? c : undefined;
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter smoltalk test -- openaiCompat`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add SmolOpenAiCompat generic OpenAI-compatible client"
```

---

## Task 5: `SmolOpenRouter` and `SmolDeepInfra` — baked URL + body-cost

**Files:**
- Create: `packages/smoltalk/lib/clients/openrouter.ts`, `packages/smoltalk/lib/clients/deepinfra.ts`
- Test: `packages/smoltalk/lib/clients/openrouter.test.ts`, `packages/smoltalk/lib/clients/deepinfra.test.ts`

**Interfaces:**
- Consumes: `SmolOpenAiCompat` (Task 4).
- Produces:
  - `export class SmolOpenRouter extends SmolOpenAiCompat` — baked `https://openrouter.ai/api/v1`, cost ← `usage.cost`, **injects `usage: { include: true }` into every request** so OpenRouter returns cost.
  - `export class SmolDeepInfra extends SmolOpenAiCompat` — baked `https://api.deepinfra.com/v1/openai`, cost ← `usage.estimated_cost`.

- [ ] **Step 1: Write the failing tests**

```ts
import { SmolOpenRouter } from "./openrouter.js";
import { SmolDeepInfra } from "./deepinfra.js";

it("openrouter: bakes the base URL and reads usage.cost", () => {
  const c = new SmolOpenRouter({ model: "z-ai/glm-5.2", provider: "openrouter", apiKey: { openRouter: "k" } });
  expect((c as any).client.baseURL).toContain("openrouter.ai");
  expect((c as any).calculateUsageAndCost({ prompt_tokens: 1, completion_tokens: 1, cost: 0.03 }).cost?.totalCost).toBe(0.03);
  // does NOT pick up estimated_cost (that's DeepInfra's field)
  expect((c as any).calculateUsageAndCost({ prompt_tokens: 1, completion_tokens: 1, estimated_cost: 0.09 }).cost?.totalCost).not.toBe(0.09);
});

it("openrouter: base URL override is honored", () => {
  const c = new SmolOpenRouter({ model: "z-ai/glm-5.2", provider: "openrouter", apiKey: { openRouter: "k" }, baseUrl: { openRouter: "https://proxy.test/v1" } });
  expect((c as any).client.baseURL).toContain("proxy.test");
});

it("deepinfra: bakes the base URL and reads usage.estimated_cost", () => {
  const c = new SmolDeepInfra({ model: "zai-org/GLM-5.2", provider: "deepinfra", apiKey: { deepInfra: "k" } });
  expect((c as any).client.baseURL).toContain("deepinfra.com");
  expect((c as any).calculateUsageAndCost({ prompt_tokens: 1, completion_tokens: 1, estimated_cost: 0.04 }).cost?.totalCost).toBe(0.04);
});

it("both throw a clear error when the key is missing", () => {
  expect(() => new SmolOpenRouter({ model: "z-ai/glm-5.2", provider: "openrouter" })).toThrow(/API key/i);
  expect(() => new SmolDeepInfra({ model: "zai-org/GLM-5.2", provider: "deepinfra" })).toThrow(/API key/i);
});

it("openrouter: injects usage:{include:true} into the request body", () => {
  // Mock the SDK call to capture the request. Pattern depends on how
  // existing openai.test.ts mocks the openai SDK — match it.
  // The asserted invariant: the request passed to chat.completions.create()
  // contains `usage: { include: true }`, even if the caller didn't set it.
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter smoltalk test -- openrouter deepinfra`
Expected: FAIL (modules do not exist).

- [ ] **Step 3: Implement `SmolOpenRouter`**

OpenRouter only returns `usage.cost` when the request body sets `usage: { include: true }`. We inject that by overriding the request-building seam in `SmolOpenAi`. Identify that seam in Task 0/2 — it's either the place that constructs the object passed to `chat.completions.create(...)`, or we add a small `protected buildRequestExtras(): object` hook in `SmolOpenAi` (Task 2 may need a tiny addendum) that subclasses can override:

```ts
// In SmolOpenAi (Task 2 addendum):
protected buildRequestExtras(_config: SmolConfig): Record<string, unknown> {
  return {};
}
// ...and merge into the request:
const request = { ...baseRequest, ...this.buildRequestExtras(config) };
```

```ts
import { SmolOpenAiCompat } from "./openaiCompat.js";
import type { SmolConfig } from "../types.js";

export class SmolOpenRouter extends SmolOpenAiCompat {
  protected resolveClientOptions(config: SmolConfig): { apiKey: string; baseURL: string } {
    const apiKey = config.apiKey?.openRouter || process.env.OPENROUTER_API_KEY;
    const baseURL = config.baseUrl?.openRouter || "https://openrouter.ai/api/v1";
    if (!apiKey) throw new Error("openrouter: API key required (config.apiKey.openRouter or OPENROUTER_API_KEY).");
    return { apiKey, baseURL };
  }

  protected resolveCostUsd(usage: any): number | undefined {
    return typeof usage?.cost === "number" ? usage.cost : undefined;
  }

  // Required: OpenRouter only returns usage.cost when this is set.
  protected buildRequestExtras() {
    return { usage: { include: true } };
  }
}
```

If adding `buildRequestExtras` to `SmolOpenAi` feels heavy, an acceptable alternative is to use `config.rawAttributes` as the merge point — but that would let callers accidentally turn cost reporting off, so the hook is preferred.

- [ ] **Step 4: Implement `SmolDeepInfra`**

```ts
import { SmolOpenAiCompat } from "./openaiCompat.js";
import type { SmolConfig } from "../types.js";

export class SmolDeepInfra extends SmolOpenAiCompat {
  protected resolveClientOptions(config: SmolConfig): { apiKey: string; baseURL: string } {
    const apiKey = config.apiKey?.deepInfra || process.env.DEEPINFRA_API_KEY;
    const baseURL = config.baseUrl?.deepInfra || "https://api.deepinfra.com/v1/openai";
    if (!apiKey) throw new Error("deepinfra: API key required (config.apiKey.deepInfra or DEEPINFRA_API_KEY).");
    return { apiKey, baseURL };
  }

  protected resolveCostUsd(usage: any): number | undefined {
    // DeepInfra returns usage.estimated_cost (USD) on chat completions. If they
    // ever rename it the Task 8 live test will catch the regression.
    return typeof usage?.estimated_cost === "number" ? usage.estimated_cost : undefined;
  }
}
```

- [ ] **Step 5: Run them to verify they pass**

Run: `pnpm --filter smoltalk test -- openrouter deepinfra`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add SmolOpenRouter and SmolDeepInfra clients"
```

---

## Task 6: `SmolLiteLlm` — user URL + header-cost

**Files:**
- Create: `packages/smoltalk/lib/clients/litellm.ts`
- Test: `packages/smoltalk/lib/clients/litellm.test.ts`

**Interfaces:**
- Consumes: `SmolOpenAiCompat` (Task 4); raw-response threading (Task 2).
- Produces: `export class SmolLiteLlm extends SmolOpenAiCompat` (required user URL; cost ← `x-litellm-response-cost` header via `rawResponse`).

- [ ] **Step 1: Write the failing test**

```ts
import { SmolLiteLlm } from "./litellm.js";

const base = { model: "openai/gpt-4o", provider: "litellm" as const };

it("requires a base URL and key", () => {
  expect(() => new SmolLiteLlm({ ...base, apiKey: { liteLlm: "k" } })).toThrow(/base URL/i);
  expect(() => new SmolLiteLlm({ ...base, baseUrl: { liteLlm: "http://localhost:4000" } })).toThrow(/API key/i);
});

it("reads cost from the x-litellm-response-cost header", () => {
  const c = new SmolLiteLlm({ ...base, apiKey: { liteLlm: "k" }, baseUrl: { liteLlm: "http://localhost:4000" } });
  const resp = new Response(null, { headers: { "x-litellm-response-cost": "0.0021" } });
  // calculateUsageAndCost is protected — reach in for the unit test only.
  expect((c as any).calculateUsageAndCost({ prompt_tokens: 10, completion_tokens: 5 }, resp).cost?.totalCost).toBe(0.0021);
});

it("returns no provider cost when the header is absent (e.g. streaming)", () => {
  const c = new SmolLiteLlm({ ...base, apiKey: { liteLlm: "k" }, baseUrl: { liteLlm: "http://localhost:4000" } });
  const { cost } = (c as any).calculateUsageAndCost({ prompt_tokens: 10, completion_tokens: 5 }); // no rawResponse
  // unknown model "openai/gpt-4o" is not in the registry → cost null/undefined
  expect(cost?.totalCost).toBeUndefined();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter smoltalk test -- litellm`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement `SmolLiteLlm`**

```ts
import { SmolOpenAiCompat } from "./openaiCompat.js";
import type { SmolConfig } from "../types.js";

export class SmolLiteLlm extends SmolOpenAiCompat {
  protected resolveClientOptions(config: SmolConfig): { apiKey: string; baseURL: string } {
    const apiKey = config.apiKey?.liteLlm || process.env.LITELLM_API_KEY;
    const baseURL = config.baseUrl?.liteLlm || process.env.LITELLM_BASE_URL;
    if (!apiKey) throw new Error("litellm: API key required (config.apiKey.liteLlm or LITELLM_API_KEY).");
    if (!baseURL) throw new Error("litellm: base URL required (config.baseUrl.liteLlm or LITELLM_BASE_URL).");
    return { apiKey, baseURL };
  }

  protected resolveCostUsd(_usage: any, rawResponse?: Response): number | undefined {
    const header = rawResponse?.headers?.get?.("x-litellm-response-cost");
    if (!header) return undefined;
    const n = Number(header);
    return Number.isFinite(n) ? n : undefined;
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter smoltalk test -- litellm`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add SmolLiteLlm client with header-based cost"
```

---

## Task 7: Register the four providers (enum, switch, key resolution)

**Files:**
- Modify: `packages/smoltalk/lib/models.ts` (`providers` array → `ProviderSchema`)
- Modify: `packages/smoltalk/lib/client.ts` (`getClient` switch)
- Modify: `packages/smoltalk/lib/util/provider.ts` (`resolveApiKey` switch)
- Test: `packages/smoltalk/lib/client.test.ts`

**Interfaces:**
- Consumes: all four client classes (Tasks 4–6).
- Produces: `getClient({ provider: "openrouter" | "deepinfra" | "litellm" | "openai-compat", ... })` returns the matching client; `resolveApiKey` knows the four providers.

- [ ] **Step 1: Write the failing test**

```ts
import { getClient } from "./client.js";

it("routes the four new providers", () => {
  expect(getClient({ model: "z-ai/glm-5.2", provider: "openrouter", apiKey: { openRouter: "k" } }).constructor.name).toBe("SmolOpenRouter");
  expect(getClient({ model: "zai-org/GLM-5.2", provider: "deepinfra", apiKey: { deepInfra: "k" } }).constructor.name).toBe("SmolDeepInfra");
  expect(getClient({ model: "openai/gpt-4o", provider: "litellm", apiKey: { liteLlm: "k" }, baseUrl: { liteLlm: "http://localhost:4000" } }).constructor.name).toBe("SmolLiteLlm");
  expect(getClient({ model: "x/y", provider: "openai-compat", apiKey: { openAiCompat: "k" }, baseUrl: { openAiCompat: "https://h.test/v1" } }).constructor.name).toBe("SmolOpenAiCompat");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter smoltalk test -- client.test`
Expected: FAIL (provider not in enum / hits `default:` → throws "not supported").

- [ ] **Step 3: Add the names to the `providers` array**

In `packages/smoltalk/lib/models.ts`, extend the `providers` array at L9 (feeds `ProviderSchema` at L18):

```ts
export const providers = [
  "ollama", "openai", "openai-responses", "anthropic", "google", "replicate", "modal",
  "openrouter", "deepinfra", "litellm", "openai-compat",
] as const;
```

- [ ] **Step 4: Add the `getClient` switch cases**

In `getClient`, before `default:`, add (import the four classes at the top):

```ts
case "openrouter":
  return new SmolOpenRouter(clientConfig);
case "deepinfra":
  return new SmolDeepInfra(clientConfig);
case "litellm":
  return new SmolLiteLlm(clientConfig);
case "openai-compat":
  return new SmolOpenAiCompat(clientConfig);
```

(The clients throw clear key/URL errors themselves, so no pre-check is needed.)

- [ ] **Step 5: Extend `resolveApiKey`**

Add the four cases to `resolveApiKey`'s switch (matching each client's `resolveClientOptions`):

```ts
case "openrouter":
  return k?.openRouter || process.env.OPENROUTER_API_KEY;
case "deepinfra":
  return k?.deepInfra || process.env.DEEPINFRA_API_KEY;
case "litellm":
  return k?.liteLlm || process.env.LITELLM_API_KEY;
case "openai-compat":
  return k?.openAiCompat || process.env.OPENAI_COMPAT_API_KEY;
```

- [ ] **Step 6: Run the test + full suite**

Run: `pnpm test` (workspace root, full suite)
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: register openrouter/deepinfra/litellm/openai-compat providers"
```

---

## Task 8: Extend `embed()` to the new providers

**Support matrix** (verified against each provider's docs):

| Provider       | Native `/embeddings` endpoint? | How                                                          |
| -------------- | ------------------------------ | ------------------------------------------------------------ |
| `deepinfra`    | yes (OpenAI-compatible)        | Use the same `/v1/openai` base URL as chat                   |
| `litellm`      | yes (passes through)           | User's LiteLLM proxy maps to whatever model alias they set   |
| `openai-compat`| depends on the backend         | User opts in by passing the provider; we just forward        |
| `openrouter`   | no                             | Return a clear `failure("openrouter does not support embeddings")` |

**Files:**
- Create: `packages/smoltalk/lib/embed/openaiCompat.ts` — a generic OpenAI-compatible embed function that takes a config-supplied baseURL + apiKey + (optional) cost field name; reuses the shape of `embed/openai.ts`
- Modify: `packages/smoltalk/lib/embed.ts` — add `openrouter` / `deepinfra` / `litellm` / `openai-compat` cases to the switch (three call the new `openaiCompatEmbed`, one returns a `failure`)
- Test: `packages/smoltalk/lib/embed/openaiCompat.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { openaiCompatEmbed } from "./openaiCompat.js";

// Mock the openai SDK the same way embed/openai.test.ts does (confirm pattern in Task 0).
it("uses the supplied baseURL/apiKey and returns embeddings", async () => {
  // ...mock client.embeddings.create to return { data: [{embedding: [0.1, 0.2], index: 0}], usage: { prompt_tokens: 3 }, model: "x" }
  const res = await openaiCompatEmbed(["hi"], {
    model: "x",
    provider: "deepinfra",
    apiKey: { deepInfra: "k" },
    baseUrl: { deepInfra: "https://api.deepinfra.com/v1/openai" },
  } as any, "k", "https://api.deepinfra.com/v1/openai");
  expect(res.ok).toBe(true);
});

it("embed router returns failure for openrouter", async () => {
  const { embed } = await import("../embed.js");
  const res = await embed("hi", { model: "anything", provider: "openrouter", apiKey: { openRouter: "k" } });
  expect(res.ok).toBe(false);
  expect((res as any).error).toMatch(/openrouter.*embedd/i);
});
```

- [ ] **Step 2: Implement `openaiCompatEmbed`**

Copy `embed/openai.ts` and parameterize the `OpenAI({...})` constructor with the caller-supplied `baseURL`. Drop the smoltalk-registry cost lookup for `openai-compat`/`deepinfra` (the chat-side `usage.estimated_cost` field doesn't exist on embedding responses; cost stays `undefined` unless the registry has the model).

- [ ] **Step 3: Wire it into the `embed()` router**

In `embed.ts`, after the existing `ollama` case:

```ts
case "openrouter":
  return failure("openrouter does not expose an embeddings endpoint; use deepinfra or openai-compat instead.");
case "deepinfra": {
  const baseURL = config.baseUrl?.deepInfra || "https://api.deepinfra.com/v1/openai";
  const apiKey = config.apiKey?.deepInfra || process.env.DEEPINFRA_API_KEY;
  if (!apiKey) return failure("deepinfra: API key required (config.apiKey.deepInfra or DEEPINFRA_API_KEY).");
  return openaiCompatEmbed(inputs, config, apiKey, baseURL);
}
case "litellm": {
  const baseURL = config.baseUrl?.liteLlm || process.env.LITELLM_BASE_URL;
  const apiKey = config.apiKey?.liteLlm || process.env.LITELLM_API_KEY;
  if (!apiKey) return failure("litellm: API key required.");
  if (!baseURL) return failure("litellm: base URL required.");
  return openaiCompatEmbed(inputs, config, apiKey, baseURL);
}
case "openai-compat": {
  const baseURL = config.baseUrl?.openAiCompat || process.env.OPENAI_COMPAT_BASE_URL;
  const apiKey = config.apiKey?.openAiCompat || process.env.OPENAI_COMPAT_API_KEY;
  if (!apiKey) return failure("openai-compat: API key required.");
  if (!baseURL) return failure("openai-compat: base URL required.");
  return openaiCompatEmbed(inputs, config, apiKey, baseURL);
}
```

- [ ] **Step 4: Run + commit**

```bash
pnpm --filter smoltalk test -- embed
git add -A
git commit -m "feat(embed): support deepinfra/litellm/openai-compat (openrouter returns clear failure)"
```

---

## Task 9: Extend `image()` to the new providers

**Support matrix:**

| Provider       | Native OpenAI-compatible `/images/generations`? |
| -------------- | ----------------------------------------------- |
| `openrouter`   | no — return a clear failure                     |
| `deepinfra`    | no (DeepInfra has its own model-specific image endpoints, not OpenAI shape) — return a clear failure |
| `litellm`      | yes (passes through to whatever model alias)    |
| `openai-compat`| depends on backend — forward                    |

**Files:**
- Create: `packages/smoltalk/lib/image/openaiCompat.ts` — mirror of `image/openai.ts` parameterized on `baseURL`/`apiKey`
- Modify: `packages/smoltalk/lib/image.ts` — add the four cases
- Test: `packages/smoltalk/lib/image/openaiCompat.test.ts`

Steps mirror Task 8 in structure. The two unsupported providers (`openrouter`, `deepinfra`) return a clear `failure("X does not expose an OpenAI-compatible images endpoint; use openai-compat or litellm instead.")`.

- [ ] **Step 1: Write failing tests** (one happy-path for openai-compat, one failure-path for openrouter/deepinfra)
- [ ] **Step 2: Implement `openaiCompatImage`**
- [ ] **Step 3: Wire it into the `image()` router** (analogous switch additions)
- [ ] **Step 4: Run + commit**

```bash
pnpm --filter smoltalk test -- image
git add -A
git commit -m "feat(image): support litellm/openai-compat (openrouter/deepinfra return clear failure)"
```

---

## Task 10: Hosted tool — OpenRouter `web_search`

**Why OpenRouter only:** Of the four new providers, only OpenRouter offers a uniform web-search hosted tool API (the `:online` model suffix, or `plugins: [{ id: "web", max_results: N }]` in the request body, with citations returned as `annotations` on the assistant message). DeepInfra has no native web search. LiteLLM passes through whatever the upstream model offers — if you point LiteLLM at OpenAI, `web_search` already works via smoltalk's existing OpenAI hosted-tool path; no new code needed. `openai-compat` is too generic to know.

**Files:**
- Modify: `packages/smoltalk/lib/models.ts` — add an OpenRouter row to the hosted-tools catalog declaring `web_search` (`category: "web_search"`, `provider: "openrouter"`, pricing per OpenRouter docs — typically free or model-dependent; if not knowable, omit pricing and let `estimatedCost` stay `undefined`)
- Modify: `packages/smoltalk/lib/clients/openrouter.ts` —
  - extend `buildRequestExtras` to merge `{ plugins: [{ id: "web", max_results: 5 }] }` when `config.hostedTools?.includes("web_search")`
  - parse the response: read `choices[0].message.annotations` (OpenRouter returns `{ type: "url_citation", url_citation: { url, title, content, start_index, end_index } }` entries) and emit a `HostedToolResult` via `webSearchResult("openrouter", { sources, citations, callCount: 1 })`
- Test: `packages/smoltalk/lib/clients/openrouter.hostedTools.test.ts` — mirror the existing `*.hostedTools.test.ts` files

- [ ] **Step 1: Read existing hosted-tools wiring**

Read `packages/smoltalk/lib/util/hostedTools.ts` and one example: `packages/smoltalk/lib/clients/openaiResponses.hostedTools.test.ts` (or `anthropic.hostedTools.test.ts`). Note the patterns for `validateHostedTools`, `webSearchResult`, and how the existing clients return `hostedToolResults` on `PromptResult`.

- [ ] **Step 2: Write the failing test**

Test that:
- `getClient({ provider: "openrouter", model: "openai/gpt-4o", hostedTools: ["web_search"], apiKey: { openRouter: "k" } })` validates without error.
- The mocked outgoing request contains `plugins: [{ id: "web", ... }]`.
- Given a fake response with `message.annotations` containing two `url_citation` entries, the returned `PromptResult.hostedToolResults` has one entry with `tool: "web_search"`, `provider: "openrouter"`, and `sources`/`citations` populated.

- [ ] **Step 3: Add the catalog entry and request/response handling**

Catalog row in `models.ts` (use existing hosted-tool entries as template):
```ts
{ category: "web_search", provider: "openrouter", /* pricing: omit if unknown */ }
```

In `SmolOpenRouter`, override `buildRequestExtras(config)`:
```ts
protected buildRequestExtras(config: SmolConfig) {
  const extras: Record<string, unknown> = { usage: { include: true } };
  if (config.hostedTools?.includes("web_search")) {
    extras.plugins = [{ id: "web", max_results: 5 }];
  }
  return extras;
}
```

For response parsing, follow the pattern already used by `SmolOpenAi` / `openaiResponses.ts` — extract `annotations` from the completion message and pass to `webSearchResult("openrouter", { sources, citations, callCount: 1 })`. The exact integration point depends on `SmolOpenAi`'s parsing flow — find the spot that builds the final `PromptResult` and add a subclass hook (e.g. `protected parseHostedToolResults(completion): HostedToolResult[]` returning `[]` by default; OpenRouter overrides).

- [ ] **Step 4: Run + commit**

```bash
pnpm --filter smoltalk test -- openrouter
git add -A
git commit -m "feat(hosted-tools): add openrouter web_search via :online plugins API"
```

(LiteLLM web_search: no code change needed — LiteLLM passes through; users get web_search by pointing LiteLLM at a model whose upstream supports it. Document this in Task 11 Step 5.)

---

## Task 11: Live tests + CI workflow (main-branch only)

**Files:**
- Create: `packages/smoltalk/lib/clients/openrouter.live.test.ts`
- Create: `packages/smoltalk/lib/clients/deepinfra.live.test.ts`
- Create: `packages/smoltalk/lib/clients/litellm.live.test.ts` (skipped unless `LITELLM_BASE_URL` is set; CI can spin up a proxy or leave it skipped)
- Create: `packages/smoltalk/lib/clients/openai-compat.live.test.ts` (skipped unless both `OPENAI_COMPAT_API_KEY` and `OPENAI_COMPAT_BASE_URL` are set)
- Create: `.github/workflows/live.yml` — runs only on push to `main` (no PRs, no secrets exposed to forks)
- Modify: `README.md` — short hosted-providers section

**Convention reminder:** smoltalk already uses `*.live.test.ts` for env-gated live tests (see `clients/openai.live.test.ts`, `clients/google.live.test.ts`, `clients/anthropic.live.test.ts`). Match their style — including how they skip when the env var is missing.

- [ ] **Step 1: Confirm the existing live-test gating pattern**

```bash
sed -n '1,40p' packages/smoltalk/lib/clients/openai.live.test.ts
```

Reuse the same describe-skip pattern.

- [ ] **Step 2: Write `openrouter.live.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { textSync } from "../functions.js";

const KEY = process.env.OPENROUTER_API_KEY;
const d = KEY ? describe : describe.skip;

d("openrouter (live)", () => {
  it("returns structured output with a numeric cost", async () => {
    const res = await textSync("Reply with JSON {\"answer\":\"ok\"}.", {
      provider: "openrouter",
      model: "openai/gpt-4o-mini", // cheap; adjust as needed
      apiKey: { openRouter: KEY },
      responseFormat: z.object({ answer: z.string() }),
      maxTokens: 32,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.cost?.totalCost).toBeGreaterThan(0);
    }
  });

  it("web_search hosted tool returns citations", async () => {
    const res = await textSync("What is the current date today, with a source?", {
      provider: "openrouter",
      model: "openai/gpt-4o-mini",
      apiKey: { openRouter: KEY },
      hostedTools: ["web_search"],
      maxTokens: 200,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const ws = res.value.hostedToolResults?.find(r => r.tool === "web_search");
      expect(ws?.sources?.length || 0).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 3: Write `deepinfra.live.test.ts`**

Same shape; uses a cheap DeepInfra model and `DEEPINFRA_API_KEY`. Includes one embed test:

```ts
import { embed } from "../embed.js";

it("embed: returns vectors via deepinfra", async () => {
  const res = await embed("hello", {
    model: "BAAI/bge-small-en-v1.5",
    provider: "deepinfra",
    apiKey: { deepInfra: KEY },
  });
  expect(res.ok).toBe(true);
  if (res.ok) expect(res.value.embeddings[0].length).toBeGreaterThan(0);
});
```

- [ ] **Step 4: Write `litellm.live.test.ts` and `openai-compat.live.test.ts`**

Both gated on their respective env vars (`LITELLM_API_KEY` + `LITELLM_BASE_URL`; `OPENAI_COMPAT_API_KEY` + `OPENAI_COMPAT_BASE_URL`). Single happy-path each. LiteLLM test asserts the header-derived cost works (`res.value.cost?.totalCost > 0`).

- [ ] **Step 5: Verify the live tests skip cleanly locally**

```bash
pnpm --filter smoltalk test -- live
```

Expected: all live blocks SKIPPED (no env vars set); run is green.

- [ ] **Step 6: Add the CI workflow (main-only)**

Create `.github/workflows/live.yml`:

```yaml
name: live
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
jobs:
  live:
    # Only run for direct pushes to main (not from forks via PR-then-merge).
    if: github.event_name == 'workflow_dispatch' || github.event.repository.fork == false
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter smoltalk test -- live
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          DEEPINFRA_API_KEY:  ${{ secrets.DEEPINFRA_API_KEY }}
          # LITELLM_* and OPENAI_COMPAT_* intentionally omitted: those live tests
          # remain skipped in CI unless a self-hosted proxy is wired in.
```

The existing PR/test workflow stays unchanged and runs only unit tests — no secrets touched on PRs, including from forks.

- [ ] **Step 7: README: hosted providers section**

Add a short section to `README.md`:
- Names of the four providers (kebab) and their config keys (camelCase) and env vars.
- Callers must pass an explicit `provider:` for these (model names aren't in the smoltalk registry).
- Embeddings supported on `deepinfra`/`litellm`/`openai-compat` (not OpenRouter).
- Images supported on `litellm`/`openai-compat` (not OpenRouter/DeepInfra).
- `web_search` hosted tool: native on `openrouter`; via LiteLLM if upstream supports it; not on DeepInfra; depends on backend for `openai-compat`.
- A one-liner on running a local LiteLLM proxy: `pip install 'litellm[proxy]'` → `litellm --model openai/gpt-4o` → set `config.baseUrl.liteLlm = "http://localhost:4000"`.
- The migration snippet for the breaking config change (also covered in Task 1 Step 6 but worth repeating here).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "test+ci: live tests for hosted providers + main-only CI workflow"
```

---

## Self-Review notes (coverage map)

- Spec Change 0 (nested config, including `ollamaHost` → `baseUrl.ollama`) → Task 1. Change 1 (seams) → Task 2. Change 3 (regex) → Task 3. Change 2 (clients) → Tasks 4–6. Change 4 + 5 (registration + key resolution) → Task 7. Embeddings → Task 8. Images → Task 9. Hosted tools (OpenRouter web_search) → Task 10. Live tests + main-only CI → Task 11.
- Known limitations: Fireworks dialect (documented, not coded); OpenRouter web_search pricing depends on model (catalog price may be `undefined` → `estimatedCost` undefined; not a regression); LiteLLM cost is non-stream only; DeepInfra/OpenRouter have no embedding/image symmetry with each other and we surface clear failures instead of silent ones; SDK field-preservation verified by Task 4/5 cost tests + the live tests in Task 11.
- Agency-side follow-up is explicitly out of scope for this plan.
