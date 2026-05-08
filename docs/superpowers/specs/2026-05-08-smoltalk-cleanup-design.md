# Smoltalk Cleanup — Design Spec

**Date:** 2026-05-08
**Status:** Approved for implementation
**Target version:** `0.1.0`

## Goal

Reduce Smoltalk's surface area to "a simple, unified wrapper around LLM provider APIs." Remove features that have accumulated and made the package complex without serving its core purpose. This cleanup precedes (and enables) a follow-up project that extracts `node-llama-cpp` into a separate package via a plugin API; that work is **out of scope** for this spec.

## Scope

### Removed

1. **`lib/strategies/`** — entire directory. Includes `baseStrategy`, `fallbackStrategy`, `fastestStrategy`, `idStrategy`, `raceStrategy`, `randomStrategy`, `timeoutStrategy`, `index.ts`, `types.ts`, and `strategies.test.ts`.
2. **`lib/middleware.ts` and `lib/middleware.test.ts`** — LLM-based pre/parallel validation checks.
3. **`lib/latencyTracker.ts` and `lib/latencyTracker.test.ts`** — latency sample store. Was consumed only by `fastestStrategy` and `BaseClient`'s post-call recording.
4. **`onStrategyStart` hook** on `SmolConfig.hooks` — orphaned once strategies are gone.
5. **`splitConfig()`** in `lib/functions.ts` and the supporting types (`ResolvedSmolConfig`, `BaseClientConfig`, `SmolPromptConfig`, `PromptConfig`, `ModelParam`).
6. **`getStrategy()` / `getFreshStrategy()`** in `lib/functions.ts`.
7. **`MiddlewareConfig`-related re-exports** from `lib/index.ts`.
8. **`latencyTracker` re-exports** from `lib/index.ts`.
9. **`latencyTracker.record(...)`** calls inside `lib/clients/baseClient.ts` (lines 194 and 428).

### Kept (explicit non-removals to record the decision)

- `statelogClient.ts` — observability integration stays. Only the `onStrategyStart` invocation path is cleaned up; statelog itself remains a first-class feature.
- `hooks` on `SmolConfig` — `onStart`, `onToolCall`, `onEnd`, `onError` remain. Only `onStrategyStart` is dropped.
- `toolLoopDetection` on the (now unified) config — kept.
- `openaiResponses.ts` alongside `openai.ts` — both OpenAI clients stay; users need both.
- `provider` override on `SmolConfig` — kept; useful for routing unknown model names to a known provider.
- `rawAttributes` — kept for flexibility / forward-compat with provider features.
- `responseFormat` + structured-output validation/retry — kept.
- Cost/usage tracking — kept.
- `Model` class in `lib/model.ts` — kept as a wrapper around model-name → provider lookups, even though strategy resolution goes away.

## Config Unification

Today the public functions (`text`, `textSync`, `textStream`) accept `SmolPromptConfig = SmolConfig & PromptConfig`. Internally `splitConfig()` peels them apart so `BaseClient` can be constructed with `SmolConfig` and called with `PromptConfig`. In practice `getClient()` is invoked fresh per call, so the split provides no reuse benefit — only ceremony.

**After cleanup:** one config type, named `SmolConfig`, that contains everything currently in `SmolConfig + PromptConfig`. `PromptConfig` and `SmolPromptConfig` are deleted.

### New `SmolConfig` shape

Union of today's two types, minus removed features:

- **From the old `SmolConfig`:** `openAiApiKey`, `googleApiKey`, `anthropicApiKey`, `ollamaApiKey`, `ollamaHost`, `llamaCppModelDir`, `model` (now strictly `ModelName`, no longer `ModelParam`), `provider`, `logLevel`, `statelog`, `hooks` (without `onStrategyStart`), `metadata`.
- **From the old `PromptConfig`:** `messages`, `tools`, `maxTokens`, `temperature`, `numSuggestions`, `parallelToolCalls`, `responseFormat`, `stream`, `thinking`, `reasoningEffort`, `responseFormatOptions`, `rawAttributes`, `maxMessages`, `abortSignal`, `toolLoopDetection`.
- **Removed:** `middleware` (was on `SmolConfig`).

`SmolConfig.model` becomes `ModelName` (string union from `lib/models.ts`). The strategy/object form is no longer accepted.

### Client signature changes

```ts
// Before
class BaseClient {
  constructor(config: ResolvedSmolConfig) { ... }
  textSync(config: PromptConfig): Promise<Result<PromptResult>>
  textStream(config: PromptConfig): AsyncGenerator<StreamChunk>
}

// After
class BaseClient {
  constructor(config: SmolConfig) { ... }
  textSync(config: SmolConfig): Promise<Result<PromptResult>>
  textStream(config: SmolConfig): AsyncGenerator<StreamChunk>
}
```

The constructor still exists because each provider builds its underlying SDK instance (OpenAI, Anthropic, Google `genai`, Ollama) from the API keys at construction time. Method calls receive the full config; clients read whichever fields they need per call.

All five concrete clients (`openai.ts`, `openaiResponses.ts`, `google.ts`, `anthropic.ts`, `ollama.ts`, `llamaCpp.ts`) update their constructor types from `ResolvedSmolConfig` to `SmolConfig` — mechanical change.

### `functions.ts` after cleanup

Roughly 25 lines. The body of `textSync`/`textStream` becomes:

```ts
export async function textSync(config: SmolConfig): Promise<Result<PromptResult>> {
  config.messages = fixMessagesIfNecessary(config.messages);
  const client = getClient(config);
  return client.textSync(config);
}

export async function* textStream(config: SmolConfig): AsyncGenerator<StreamChunk> {
  config.messages = fixMessagesIfNecessary(config.messages);
  const client = getClient(config);
  yield* client.textStream(config);
}
```

`text(config)` keeps its overload-based stream/sync dispatch.

### `Model` class after cleanup

`Model` keeps:
- Constructor accepting a `ModelName` string
- `getProvider()` — model-name → provider lookup
- Pricing/limit accessors

`Model` loses:
- `getResolvedModel()` — no longer needed; `model` is already a `ModelName` string. Call sites that did `this.model.getResolvedModel()` use the model name directly.
- Any branch handling strategy/object input.

`model.test.ts` keeps its provider-resolution tests; tests that exercised the strategy branch are removed.

## Public API Impact (Breaking Changes)

Reason for the `0.1.0` bump (from `0.0.67`):

1. **`model: { type: "race" | "fallback" | ... }`** is no longer accepted. Callers must pass a `ModelName` string.
2. **`middleware: { checks: [...] }`** on the config is no longer accepted.
3. **`onStrategyStart` hook** is no longer accepted.
4. **Type names removed from the public surface:** `Strategy`, `StrategyJSON`, `BaseStrategy`, `MiddlewareConfig`, `MiddlewareCheck`, `MiddlewareResult`, `LatencySample`, `latencyTracker`, `PromptConfig`, `SmolPromptConfig`, `ResolvedSmolConfig`, `BaseClientConfig`, `ModelParam`.

Callers that already passed a string `model` and didn't use middleware, strategies, or `onStrategyStart` are unaffected at the call site.

## Index / Export Updates

`lib/index.ts` after cleanup drops these lines:

```ts
export * from "./strategies/index.js";
export { latencyTracker } from "./latencyTracker.js";
export type { LatencySample } from "./latencyTracker.js";
export type { MiddlewareCheck, MiddlewareConfig, MiddlewareResult } from "./middleware.js";
```

## Testing

- Delete `strategies.test.ts`, `middleware.test.ts`, `latencyTracker.test.ts`.
- Update `model.test.ts` — remove tests that exercised strategy resolution; keep provider-resolution tests.
- Update `client.test.ts` and `baseClient.test.ts` — adjust to new constructor / config types. No behavioral test changes needed beyond type updates.
- Run `pnpm test` and `pnpm typecheck` after each removal step to catch dangling references.

## Order of Operations (for the implementation plan)

This spec describes the destination, not the path. The follow-up implementation plan should sequence the work so the codebase compiles at each step. Suggested order:

1. Remove `latencyTracker.record(...)` calls in `BaseClient`; delete `latencyTracker.ts` + test.
2. Delete `strategies/` directory; remove strategy imports from `functions.ts`, `types.ts`, `index.ts`. Replace `ModelParam` with `ModelName` in `SmolConfig.model`.
3. Delete `middleware.ts` + test; remove middleware branches in `functions.ts` and the `middleware` field on `SmolConfig`; drop the re-export from `index.ts`.
4. Drop `onStrategyStart` from `SmolConfig.hooks`; remove any invocations (statelog or elsewhere).
5. Unify `SmolConfig` + `PromptConfig`. Update `BaseClient` constructor and method signatures; update all five concrete clients; delete `splitConfig()`, `ResolvedSmolConfig`, `BaseClientConfig`, `SmolPromptConfig`, `PromptConfig`, `ModelParam`.
6. Simplify `Model` class — drop `getResolvedModel()`, update call sites in clients to use `this.config.model` directly.
7. Bump `package.json` version to `0.1.0`.
8. Update `README.md`, `CLAUDE.md`, and `TODO.md` per the Documentation Updates section.
9. Run `pnpm doc` to regenerate TypeDoc output.

## Documentation Updates

The following docs reference removed features and must be updated as part of the same change.

### `README.md`

- **Line 3 (intro):** Rewrite to drop the "build strategies on top of it" framing. New framing: "Smoltalk exposes a common API to different LLM providers, with built-in cost tracking, structured output, tool calling, streaming, and observability hooks."
- **Lines 57–86 (`fallback` / `race` / combined examples):** Delete the entire block. These examples advertise removed functionality. The "Hello world example" already demonstrates the core API.
- **Lines 161–163 (Configuration Options intro):** Replace the `SmolPromptConfig`/`SmolConfig`/`PromptConfig` framing with a single "All options are passed to `text()` as a single config object." Drop the "split between `getClient()` and individual calls" sentence.
- **Lines 165–177 (Client options table):** Merge with the request options table into a single "Configuration" table. Remove the `model` row's reference to `ModelConfig` — type is now `ModelName`. Update the `provider` row description to drop `"replicate"`, `"modal"`, `"local"` (these aren't real providers in the registry).
- **Lines 178–193 (Request options table):** Fold into the unified Configuration table. Remove the `instructions` row (not a real field — system prompts are passed via `systemMessage()` in `messages`).
- **Lines 217–298 (entire Middleware section):** Delete.
- **Lines 88–120 (Longer tutorial):** Audit. The `getClient()` + `client.prompt()` / `client.text()` pattern still works but is secondary to the top-level `text()` function. Trim or rewrite for consistency with the unified-config story; keep the tool-calling and structured-output examples since those remain core features.

### `CLAUDE.md`

The current `CLAUDE.md` does not mention strategies, middleware, or the latency tracker, so most of it is fine. Verify and update if any of the following appear after re-reading at implementation time:

- References to `lib/strategies/`, `lib/middleware.ts`, `lib/latencyTracker.ts` in the project structure tree
- References to `SmolPromptConfig`, `PromptConfig`, `splitConfig`, `ResolvedSmolConfig` in any architecture description
- The "SmolClient interface" bullet should reflect that methods now take `SmolConfig` instead of `PromptConfig`

### `TODO.md`

- **Line 4** (`add ability to use a model config as a strategy`) — delete.
- **Lines 8–9** (the ModelConfig/strategy paragraph) — delete. The decision is made: ModelConfig as a strategy concept goes away with this cleanup.
- Other lines stay (streaming tool calls, thinking-block conversion, gpt-tokenizer, llama.cpp tool/response-format support) — those are still relevant. Note: the llama.cpp item will move to the future `smoltalk-llama-cpp` package's TODO list, but that's a separate project.

### Generated API docs (`docs/`)

The `docs/` directory contains TypeDoc output (`hierarchy.html`, `interfaces/`, etc.). These are regenerated by `pnpm doc`. No manual edits needed; the implementation plan should run `pnpm doc` once after the code changes land so the published API docs reflect the new surface.

## Out of Scope (for this spec)

- Plugin API design for third-party providers
- Extraction of `node-llama-cpp` into a separate `smoltalk-llama-cpp` package
- Changelog and migration guide content (will be drafted as part of release prep, not this cleanup PR)
- Any change to message classes, tool/zod conversion, cost tracking, or provider-specific client logic beyond constructor type changes
