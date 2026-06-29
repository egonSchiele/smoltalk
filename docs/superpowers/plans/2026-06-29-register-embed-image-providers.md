# Registerable Embedding & Image Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users register custom providers for embeddings and images (as they already can for text via `registerProvider`), through parallel `registerEmbeddingProvider` / `registerImageProvider` registries.

**Architecture:** Embeddings/images stay function-shaped (not folded into `BaseClient`). Each gets a registry co-located with its `embed()`/`image()` consumer; the public functions consult the registry in their `default` case (built-ins win). `EmbedConfig`/`ImageConfig` `provider` widens to `string` to allow custom names.

**Tech Stack:** TypeScript (ESNext, `nodenext`, `strict`), vitest.

## Global Constraints

- **ES Modules:** internal imports use `.js` extensions.
- **No ternaries / conditional spreads:** explicit `if` statements (user preference). (Existing code in these files uses a ternary for `Array.isArray(input)`; leave existing code, don't add new ternaries/conditional spreads.)
- **Result type:** fallible operations return `Result<T>` (`success`/`failure` from `lib/types/result.js`); never throw.
- **Built-ins win:** registries are consulted only in the `default` case, after the built-in `switch` cases (same precedence as text in `getClient`).
- **Credentials self-served:** registered functions receive `(inputs/input, config)` and read their own credentials from `config` (e.g. `config.metadata`). No `apiKey` param in the public contract.
- **Tests:** live in `lib/` as `*.test.ts`; run `pnpm exec vitest run <file>`; full suite `pnpm test`; types `pnpm typecheck`; build `pnpm build`. `*.test.ts` is excluded from tsconfig — verify type changes via `pnpm typecheck` of lib + `pnpm build`. Unit tests run without provider API keys (built-in providers fail fast on the missing-key path, no network).
- Paths are relative to `packages/smoltalk/`.

---

### Task 1: Registerable embedding providers

**Files:**
- Modify: `lib/embed.ts`
- Test: `lib/embed.register.test.ts`

**Interfaces:**
- Produces:
  - `type EmbedProvider = (inputs: string[], config: EmbedConfig) => Promise<Result<EmbedResult>>`
  - `function registerEmbeddingProvider(name: string, fn: EmbedProvider): void`
  - `EmbedConfig.provider` widened to `string`.

- [ ] **Step 1: Write the failing test**

Create `lib/embed.register.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { embed, registerEmbeddingProvider } from "./embed.js";
import { success } from "./types/result.js";

describe("registerEmbeddingProvider", () => {
  it("dispatches to a registered custom provider", async () => {
    let received: unknown;
    registerEmbeddingProvider("fake-embed", async (inputs, config) => {
      received = { inputs, model: config.model };
      return success({ embeddings: inputs.map(() => [1, 2, 3]), model: config.model });
    });
    const result = await embed(["a", "b"], { provider: "fake-embed", model: "my-model" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.embeddings).toHaveLength(2);
      expect(result.value.model).toBe("my-model");
    }
    expect(received).toEqual({ inputs: ["a", "b"], model: "my-model" });
  });

  it("does not let a registered provider override a built-in", async () => {
    // Registering "openai" must NOT shadow the built-in openai path. With no API
    // key, the built-in returns a key error (proving the registered fn wasn't called).
    let called = false;
    registerEmbeddingProvider("openai", async (inputs, config) => {
      called = true;
      return success({ embeddings: [[0]], model: config.model });
    });
    const result = await embed(["a"], { provider: "openai", model: "text-embedding-3-small" });
    expect(called).toBe(false);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("OpenAI API key");
  });

  it("fails helpfully for an unregistered custom provider", async () => {
    const result = await embed(["a"], { provider: "no-such-embed", model: "x" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("registerEmbeddingProvider");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/embed.register.test.ts`
Expected: FAIL — `registerEmbeddingProvider` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `lib/embed.ts`, remove the now-unused `Provider` import (line 1) — `EmbedConfig.provider` becomes `string`, so `Provider` is no longer referenced:

```ts
import type { ModelDataBlob } from "./modelData.js";
```

(Delete `import { Provider } from "./models.js";`.)

Widen the `provider` field in `EmbedConfig`:

```ts
  model: string;
  provider?: string;
  dimensions?: number;
```

Add the provider type, registry, and registration function after the `EmbedResult` type (before `export async function embed`):

```ts
export type EmbedProvider = (
  inputs: string[],
  config: EmbedConfig,
) => Promise<Result<EmbedResult>>;

const registeredEmbedProviders: Record<string, EmbedProvider> = {};

export function registerEmbeddingProvider(name: string, fn: EmbedProvider): void {
  registeredEmbedProviders[name] = fn;
}
```

Replace the `default` case of the `switch` in `embed()`:

```ts
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

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm exec vitest run lib/embed.register.test.ts && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/embed.ts lib/embed.register.test.ts
git commit -m "feat(embed): register custom embedding providers"
```

---

### Task 2: Registerable image providers

**Files:**
- Modify: `lib/image.ts`
- Test: `lib/image.register.test.ts`

**Interfaces:**
- Produces:
  - `type ImageProvider = (input: ImageInput, config: ImageConfig) => Promise<Result<ImageGenResult>>`
  - `function registerImageProvider(name: string, fn: ImageProvider): void`
  - `ImageConfig.provider` widened to `string`.

- [ ] **Step 1: Write the failing test**

Create `lib/image.register.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { image, registerImageProvider } from "./image.js";
import { success } from "./types/result.js";

describe("registerImageProvider", () => {
  it("dispatches to a registered custom provider", async () => {
    let received: unknown;
    registerImageProvider("fake-image", async (input, config) => {
      received = { input, model: config.model };
      return success({
        images: [{ data: new Uint8Array([1]), mimeType: "image/png" }],
        model: config.model,
      });
    });
    const result = await image("a cat", { provider: "fake-image", model: "my-model" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.images).toHaveLength(1);
      expect(result.value.model).toBe("my-model");
    }
    expect(received).toEqual({ input: "a cat", model: "my-model" });
  });

  it("does not let a registered provider override a built-in", async () => {
    let called = false;
    registerImageProvider("openai", async (input, config) => {
      called = true;
      return success({ images: [], model: config.model });
    });
    const result = await image("a cat", { provider: "openai", model: "gpt-image-1" });
    expect(called).toBe(false);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("OpenAI API key");
  });

  it("fails helpfully for an unregistered custom provider", async () => {
    const result = await image("a cat", { provider: "no-such-image", model: "x" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("registerImageProvider");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/image.register.test.ts`
Expected: FAIL — `registerImageProvider` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `lib/image.ts`, remove the now-unused `Provider` import (line 1):

```ts
import type { ModelDataBlob } from "./modelData.js";
```

(Delete `import { Provider } from "./models.js";`.)

Widen the `provider` field in `ImageConfig`:

```ts
  model: string;
  provider?: string;
```

Add the provider type, registry, and registration function after the
`ImageGenResult` type (before `export async function image`):

```ts
export type ImageProvider = (
  input: ImageInput,
  config: ImageConfig,
) => Promise<Result<ImageGenResult>>;

const registeredImageProviders: Record<string, ImageProvider> = {};

export function registerImageProvider(name: string, fn: ImageProvider): void {
  registeredImageProviders[name] = fn;
}
```

Replace the `default` case of the `switch` in `image()`:

```ts
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

(Leave the existing `mask` guard as-is: `mask` stays OpenAI-only, so a custom image provider can't use it in this version. That's an accepted limitation, not in scope here.)

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm exec vitest run lib/image.register.test.ts && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/image.ts lib/image.register.test.ts
git commit -m "feat(image): register custom image providers"
```

---

### Task 3: Exports + README + full gate

**Files:**
- Test: `lib/exports.register.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `registerEmbeddingProvider` (Task 1), `registerImageProvider` (Task 2). Both flow out of the package root via the existing `export * from "./embed.js"` and `export * from "./image.js"` in `lib/index.ts` — this task confirms it.

- [ ] **Step 1: Write the failing test**

Create `lib/exports.register.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import * as smoltalk from "./index.js";

describe("public registration exports", () => {
  it("exposes embedding and image provider registration", () => {
    expect(typeof smoltalk.registerEmbeddingProvider).toBe("function");
    expect(typeof smoltalk.registerImageProvider).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it passes (already exported via `export *`)**

Run: `pnpm exec vitest run lib/exports.register.test.ts`
Expected: PASS. (If it FAILS, `lib/index.ts` is missing `export * from "./embed.js"` / `export * from "./image.js"` — add whichever is absent, then re-run to PASS.)

- [ ] **Step 3: Write the docs**

Add to `README.md`, immediately before `## Limitations`:

````markdown
## Registering custom providers

Smoltalk has three registration entry points — one per capability:

```ts
import {
  registerProvider,           // text generation (a class extending BaseClient)
  registerEmbeddingProvider,  // embeddings (a function)
  registerImageProvider,      // images (a function)
} from "smoltalk";

// Text: a class extending BaseClient (implements _textSync / _textStream)
registerProvider("my-llm", MyTextClient);

// Embeddings: a function
registerEmbeddingProvider("my-embed", async (inputs, config) => {
  // read credentials from config (e.g. config.metadata), call your service
  return success({ embeddings: [...], model: config.model });
});

// Images: a function
registerImageProvider("my-image", async (input, config) => {
  return success({ images: [...], model: config.model });
});
```

Select a custom provider by passing `provider` in the call config
(`embed(input, { provider: "my-embed", model })`,
`image(input, { provider: "my-image", model })`). Built-in providers always take
precedence; a registered name that collides with a built-in is ignored. Custom
providers receive the full `config` and read their own credentials from it
(e.g. `config.metadata`).

Text is a class (it needs retries, tool-loop detection, streaming); embeddings
and images are one-shot functions.
````

- [ ] **Step 4: Full gate**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add lib/exports.register.test.ts README.md
git commit -m "docs: document custom embedding/image provider registration"
```

---

## Notes on scope

- **In:** `registerEmbeddingProvider` / `registerImageProvider` + registries + dispatch + `provider` widening + exports + docs.
- **Out (per spec):** no `BaseClient`/`SmolClient` changes; no descriptor-style unified registration; no `registerProvider` rename; custom image providers can't use `mask` (stays OpenAI-only); no credential auto-resolution for custom providers.
