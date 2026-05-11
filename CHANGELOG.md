# Changelog

## smoltalk 0.3.0 (2026-05-11)

**Behavior change for `responseFormat`.** Validation, retry, and normalization now run whenever `responseFormat` is set on the config — `responseFormatOptions.strict` is no longer required to enable them. After the call, `output` is the parsed/validated object (matching what users with `strict: true` already received), not the raw model string. Markdown-fenced JSON (common from Anthropic) is stripped automatically.

**What `strict: true` now means**, and only that: turn on the provider's native server-side strict mode. For OpenAI Chat and Responses APIs, `strict: true` is now passed to the `json_schema` config — when OpenAI rejects a schema that isn't strict-compatible (i.e., not all `additionalProperties: false` with all properties `required`), the call fails fast. For other providers, `strict` is a no-op.

### Migration

- If you set `responseFormat` without `strict` and were doing `JSON.parse(result.value.output)` yourself, drop the parse — `output` is already the parsed object.
- If you set `responseFormat` without `strict` and relied on raw passthrough (no validation), add `numRetries: 0` to disable retries; you'll still get a validated/normalized object on success.
- If you set `responseFormat` with `strict: true` against OpenAI and your Zod schema has optional properties or doesn't disallow additional properties, the call may now fail server-side. Either drop `strict`, adjust the schema, or set `responseFormatOptions.strict: false` explicitly.
- `BaseClient.extractResponse` now throws `SmolStructuredOutputError` on strings that aren't valid JSON, instead of silently returning the raw string. Direct callers should handle the throw.

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
