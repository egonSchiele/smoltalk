# Changelog

## smoltalk 0.5.1 (2026-06-29)

### Fixed
- Hosted-tool validation now respects the `provider` override, so requesting `hostedTools: ["web_search"]` on an OpenAI chat model routed through `provider: "openai-responses"` is no longer wrongly rejected. Cost estimation honors the producing provider too, so web-search cost is no longer silently dropped for these calls.

## smoltalk 0.5.0 (2026-06-29)

### Added
- Runtime model-data refresh: `refreshModels()` pulls updated model data from a default URL, a URL you control, or a local `file://` path. Then you can use `registerModelData()` to register it once, or provide a `config.modelData` per call.
- Hosted-tools catalog: `getHostedTools()` and `hostedToolPricingFor()` expose which server-side tools each provider offers (web search, code execution, file search, image generation, etc) plus structured pricing.
- Hosted web search: enable per call with `hostedTools: ["web_search"]` on Anthropic, Google, and OpenAI Responses models. Results come back normalized in `PromptResult.hostedToolResults`, with an estimated cost folded into `CostEstimate`.
- `registerEmbeddingProvider()` and `registerImageProvider()` to register custom providers for `embed()` and `image()`, just like `registerProvider()` for text.
- New optional metadata fields for models: knowledge cutoff, release/updated dates, modalities, family, capability flags, and tiered/audio pricing.

### Changed
- Refreshed the baked-in model registry from models.dev. Corrected pricing and context limits, added models including `claude-opus-4-5`, `claude-sonnet-4-5`, `claude-haiku-4-5`, and `gpt-5-pro`.

## smoltalk 0.4.2 (2026-06-24)

### Added
- Exposed HTTP status, an allowlisted subset of response headers, the provider request id, and a parsed `retryAfterMs` on `SmolError`, plus new `SmolRateLimitError`, `SmolOverloadedError`, and `SmolAuthError` subclasses so retry code can `instanceof`-dispatch instead of sniffing status numbers.

### Security
- The raw provider error on `SmolError.cause` is now non-enumerable, with `toJSON` and `util.inspect` overrides — `JSON.stringify(err)`, structured loggers, and `console.error(err)` no longer leak `set-cookie` / `authorization` / `x-api-key` from upstream responses.
- Message `fromJSON` parse failures no longer dump the full payload (prompts, tool arguments, tool results) to `console.error` unconditionally; the raw JSON now prints only at debug log level.

## smoltalk 0.4.1 (2026-06-20)

### Changed
- Anthropic models default to adaptive `thinking` budgets.
- OpenAI models that only support the Responses API are now routed through it automatically.

## smoltalk 0.4.0 (2026-06-03)

### Added
- Anthropic prompt-caching support, with corrected cost estimation that no longer double-counts cached input tokens.

### Changed
- Refreshed the model registry.

## smoltalk 0.3.0 (2026-05-13)

- Added `image()` function for image generation.
- Added `embed()` function for embeddings.
- Updated model registry.
- Reverted experimental structured output retry/parsing and stricter structured output types from 0.2.1.
- CI: handle code-fenced JSON in live tests; updated Gemini image model name.

## smoltalk 0.2.0 (2026-05-08)

**Breaking:** `node-llama-cpp` is no longer a dependency of `smoltalk`. Local-model users must install [`smoltalk-llama-cpp`](./packages/smoltalk-llama-cpp/) and register it manually.

`egonlog` is also no longer an external dependency — it's been inlined into `lib/util/logger.ts`. The `EgonLog` class, `LogLevel` type, and `getLogger()` function are now exported from `smoltalk` directly. `EgonLogConfig` is internal and not exported.

### Migration

Before:
```ts
import { text } from "smoltalk";

await text({
  model: "model.gguf",
  provider: "llama-cpp",
  llamaCppModelDir: "./models",
  messages: [...],
});
```

After:
```ts
import { registerProvider, text } from "smoltalk";
import { LlamaCPP } from "smoltalk-llama-cpp";

registerProvider("llama-cpp", LlamaCPP);

await text({
  model: "model.gguf",
  provider: "llama-cpp",
  metadata: { llamaCppModelDir: "./models" },
  messages: [...],
});
```

Changes:
- `llamaCppModelDir` moves from a top-level field on the config to `metadata.llamaCppModelDir`
- `LlamaCPP` is no longer exported from `smoltalk`; import it from `smoltalk-llama-cpp` instead
- The `pnpm pull` script (which used `node-llama-cpp pull`) is gone — install `smoltalk-llama-cpp` if you need it
- If you imported `EgonLog` or `LogLevel` directly from `egonlog`, import them from `smoltalk` instead
- `EgonLog` no longer has `startTimer()`, `endTimer()`, or `time()` methods — those were unused in smoltalk and have been removed
- `getLogger(level)` now applies the level on every call, not just the first one. Previously, calling `getLogger("error")` after `getLogger("debug")` was silently ignored

## smoltalk-llama-cpp 0.1.0 (2026-05-08)

Initial release. Extracted from `smoltalk` core.

## smoltalk 0.1.0 (2026-05-08)

**Breaking:** removed several features that had accumulated and made the package complex without serving the core "wrapper around LLM provider APIs" purpose.

Changes:
- Removed the `lib/strategies/` directory — `model: { type: "race", ... }`, `model: fallback(...)`, etc. no longer work. Pass a `ModelName` string for `model`. Implement fallback or race logic in your own code if needed.
- Removed `lib/middleware.ts` and the `middleware` field on `SmolConfig`. Implement LLM-based pre/parallel validation externally.
- Removed `lib/latencyTracker.ts` and its `latencyTracker` export. The library no longer instruments per-call latency.
- Removed the `onStrategyStart` lifecycle hook (orphaned with strategies gone).
- Unified `SmolConfig` and `PromptConfig` into a single `SmolConfig` type. `SmolPromptConfig`, `ResolvedSmolConfig`, `BaseClientConfig`, `PromptConfig`, and `ModelParam` are no longer exported.
- Added `SmolClientConfig = Omit<SmolConfig, "messages"> & { messages?: Message[] }` for `getClient()`, so constructing a client doesn't require dummy messages.
- Simplified the `Model` class — `getResolvedModel()` is gone (use `getModel()`).
- Collapsed `BaseClient.text()` overloads from four to two.

If you were using strategies, middleware, latency tracking, or any of the removed types, the recommended migration is to drop the abstraction and call providers directly through `text()`/`textSync()`/`textStream()`.
