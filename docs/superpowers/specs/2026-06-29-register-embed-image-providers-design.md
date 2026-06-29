# Design: Registerable embedding & image providers

Date: 2026-06-29
Status: Approved (pending spec review)

## Goal

Let users register custom providers for **embeddings** and **images**, the way
they already can for text generation via `registerProvider`. Today `embed()` and
`image()` dispatch through a hardcoded `switch` and fail for any non-built-in
provider; there is no registry.

## Decision: don't fold into BaseClient

Text providers are **classes** extending `BaseClient` (which carries text-only
machinery: retries, tool-loop detection, response-format validation, message
limits, hosted-tool validation, streaming dispatch) and every `SmolClient`
method takes `SmolConfig`. Embeddings/images are **one-shot functions** with
their own configs (`EmbedConfig`, `ImageConfig`) that have no `messages`/`tools`.

Folding embeddings/images into `SmolClient`/`BaseClient` was rejected because it
would force a config-type mismatch (`SmolConfig` vs `EmbedConfig`/`ImageConfig`),
a fat interface (providers stubbing capabilities they don't implement), and
inheritance of irrelevant text machinery. Instead we keep embeddings/images as
focused, function-shaped providers and add **parallel registries** — mirroring
how `registeredProviders` already works for text in `lib/client.ts`.

## Scope

**In:**
- `registerEmbeddingProvider(name, fn)` + `registerImageProvider(name, fn)`, with
  exported `EmbedProvider` / `ImageProvider` function types.
- `embed()` / `image()` consult their registry in the `default` case.
- Widen `EmbedConfig.provider` / `ImageConfig.provider` from `Provider` to `string`.
- Exports + docs.

**Out (unchanged / not doing):**
- No changes to `BaseClient`, `SmolClient`, or `registerProvider` (text).
- No new class hierarchy for embeddings/images; they stay functions.
- No automatic credential resolution for custom providers (they self-serve from `config`).

## 1. Registries & registration API

Co-located with their consumers (as `registeredProviders` lives beside
`getClient`):

```ts
// lib/embed.ts
export type EmbedProvider = (
  inputs: string[],
  config: EmbedConfig,
) => Promise<Result<EmbedResult>>;

const registeredEmbedProviders: Record<string, EmbedProvider> = {};

export function registerEmbeddingProvider(name: string, fn: EmbedProvider): void {
  registeredEmbedProviders[name] = fn;
}
```

```ts
// lib/image.ts
export type ImageProvider = (
  input: ImageInput,
  config: ImageConfig,
) => Promise<Result<ImageGenResult>>;

const registeredImageProviders: Record<string, ImageProvider> = {};

export function registerImageProvider(name: string, fn: ImageProvider): void {
  registeredImageProviders[name] = fn;
}
```

**Credentials:** registered functions receive `inputs`/`input` + the full
`config` and **self-serve credentials from `config`** (e.g. `config.metadata`, or
a custom key field they document) — consistent with how the `llama-cpp` text
plugin reads `config.metadata.llamaCppModelDir`. The built-in functions keep
their internal `apiKey` parameter (resolved via `resolveApiKey`, which only knows
the built-in providers); that parameter is not part of the public registration
contract.

## 2. Dispatch

Built-ins win (same precedence as text, where registered providers are only
consulted in `getClient`'s `default`). The `default` case of each function
consults the registry instead of failing outright:

```ts
// embed()
default: {
  const custom = registeredEmbedProviders[provider];
  if (custom) {
    return custom(inputs, config);
  }
  return failure(
    `Provider "${provider}" does not support embeddings. Register one with registerEmbeddingProvider(name, fn).`,
  );
}
```

```ts
// image()
default: {
  const custom = registeredImageProviders[provider];
  if (custom) {
    return custom(input, config);
  }
  return failure(
    `Provider "${provider}" does not support image generation. Register one with registerImageProvider(name, fn).`,
  );
}
```

Provider selection is unchanged: the user passes `config.provider: "my-svc"`
(or uses a model whose `provider` resolves to it via `registerModelData`).
`resolveProvider` already returns the explicit provider when given.

## 3. Config typing

`EmbedConfig.provider` and `ImageConfig.provider` are currently typed
`provider?: Provider` (the closed enum), which rejects custom names. Widen both
to `provider?: string`, matching `SmolConfig.provider?: string`. No other config
changes.

## 4. Components & boundaries

- `lib/embed.ts` — `EmbedProvider` type, `registeredEmbedProviders`,
  `registerEmbeddingProvider`, registry check in `embed()`'s `default`, widen
  `EmbedConfig.provider`.
- `lib/image.ts` — `ImageProvider` type, `registeredImageProviders`,
  `registerImageProvider`, registry check in `image()`'s `default`, widen
  `ImageConfig.provider`.
- `lib/index.ts` — both files are already re-exported via `export *`; the new
  symbols flow out automatically (confirm).
- README — document the three registration functions together
  (`registerProvider` for text, `registerEmbeddingProvider`,
  `registerImageProvider`), noting text is a class and embeddings/images are
  functions.

Boundary check: a caller registers a function for the capability they provide and
selects it via `config.provider`; they never touch `BaseClient` or other
capabilities. Adding a future capability would follow the same parallel-registry
pattern.

## 5. Error handling

- Unregistered, non-built-in provider → `failure(...)` with a message pointing at
  the right `register*` function (as today, but now mentioning registration).
- A registered function that throws is the provider's responsibility; like the
  built-ins, it should return `Result` (`failure(...)`) rather than throw. We do
  not wrap it (consistent with how `getClient` returns registered text clients
  without wrapping construction).

## 6. Testing

- `registerEmbeddingProvider` + `embed({ provider: "fake", model: "..." })`
  dispatches to the registered fn and returns its result; the fn receives the
  `config`.
- `registerImageProvider` + `image(..., { provider: "fake" })` likewise.
- Built-ins still win: registering a provider named `"openai"` does not override
  the built-in path (registry only consulted in `default`).
- An unregistered custom provider still returns the helpful failure message.
- `EmbedConfig`/`ImageConfig` accept a custom `provider` string (type-level;
  verified via the tests compiling + `pnpm typecheck`).

## Out of scope (YAGNI)

- Unified/descriptor registration (`registerProvider(name, { client?, embed?, image? })`).
- Folding embeddings/images into `BaseClient`/`SmolClient`.
- Renaming `registerProvider` → `registerTextProvider` (keep for back-compat).
- Credential auto-resolution for custom providers.
