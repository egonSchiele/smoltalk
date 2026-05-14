# smoltalk-webllm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new workspace package `smoltalk-webllm` that lets smoltalk users run LLMs in the browser via WebGPU, using `@mlc-ai/web-llm` under the hood. Mirrors the existing `smoltalk-llama-cpp` plugin pattern (users call `registerProvider("webllm", WebLLMClient)` themselves).

**Architecture:** Single-runtime plugin package that extends `BaseClient` from smoltalk core. Provides explicit `loadModel`/`unloadModel` lifecycle, a module-level engine registry keyed by model ID. ESM-only, browser-targeted, peer-depends on `smoltalk`. The class `WebLLMClient` is exported and the user calls `registerProvider("webllm", WebLLMClient)` themselves — same pattern as `smoltalk-llama-cpp`.

**Tech Stack:** TypeScript (strict, ESNext, nodenext modules), pnpm workspaces, vitest (jsdom env), `@mlc-ai/web-llm`, `zod`. `vitest` and `typescript` are *not* declared in this package — they live at the workspace root and pnpm hoists them, exactly like `smoltalk` and `smoltalk-llama-cpp`.

**Spec:** `docs/superpowers/specs/2026-05-13-browser-packages-design.md`

---

## Pre-flight: locked-in technical decisions (resolved during planning)

These were verified against the smoltalk core source so the implementer doesn't have to re-discover them:

- **Tool conversion**: `zodToOpenAITool(name, schema, options?)` — exported from `smoltalk` (defined in `packages/smoltalk/lib/util/tool.ts`). Returns `{ type: "function", function: { name, description, parameters } }`.
- **TokenUsage shape**: `{ inputTokens, outputTokens, cachedInputTokens?, totalTokens? }`.
- **CostEstimate shape**: `{ inputCost, outputCost, cachedInputCost?, totalCost, currency }` — `currency` is **required**. Use `"USD"` and zeros for local models.
- **JSON Schema conversion**: smoltalk core uses zod 4's built-in `schema.toJSONSchema()` — no `zod-to-json-schema` dep needed.
- **`response_format` shape**: matches OpenAI — `{ type: "json_schema", json_schema: { name, schema } }`.
- **Public test surface**: `BaseClient.textSync(config)` and `BaseClient.textStream(config)` are public — tests should call those, not the underscore-prefixed internals.
- **`registerProvider` lives in `smoltalk` core**: users call it themselves; this package does NOT export a `register()` helper. Mirrors `smoltalk-llama-cpp`.

---

## Files

**Created:**
- `packages/smoltalk-webllm/package.json`
- `packages/smoltalk-webllm/tsconfig.json`
- `packages/smoltalk-webllm/makefile` (lowercase)
- `packages/smoltalk-webllm/README.md`
- `packages/smoltalk-webllm/vitest.config.ts`
- `packages/smoltalk-webllm/lib/index.ts` — public exports
- `packages/smoltalk-webllm/lib/types.ts` — `LoadOptions`, `LoadProgress`, `CustomModel`
- `packages/smoltalk-webllm/lib/engine.ts` — `loadModel`, `unloadModel`, `getEngine`, `isLoaded`
- `packages/smoltalk-webllm/lib/client.ts` — `WebLLMClient extends BaseClient`
- `packages/smoltalk-webllm/lib/engine.test.ts`
- `packages/smoltalk-webllm/lib/client.test.ts`

**Modified:**
- `makefile` (repo root) — add `smoltalk-webllm` to `PACKAGES`
- `CLAUDE.md` (repo root) — mention the new package in Project Overview

---

## Task 1: Scaffold the package

**Files:**
- Create: `packages/smoltalk-webllm/package.json`
- Create: `packages/smoltalk-webllm/tsconfig.json`
- Create: `packages/smoltalk-webllm/makefile`
- Create: `packages/smoltalk-webllm/README.md`
- Create: `packages/smoltalk-webllm/vitest.config.ts`
- Create: `packages/smoltalk-webllm/lib/index.ts` (empty placeholder)

- [ ] **Step 1: Create `packages/smoltalk-webllm/package.json`**

```json
{
  "name": "smoltalk-webllm",
  "version": "0.1.0",
  "description": "WebLLM (WebGPU) browser provider for smoltalk",
  "type": "module",
  "sideEffects": false,
  "scripts": {
    "build": "rm -rf dist && tsc",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "files": ["./dist"],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.js"
    }
  },
  "types": "./dist/index.d.ts",
  "browser": "./dist/index.js",
  "keywords": ["smoltalk", "llm", "webllm", "webgpu", "browser", "local"],
  "license": "ISC",
  "dependencies": {
    "@mlc-ai/web-llm": "^0.2.83"
  },
  "peerDependencies": {
    "smoltalk": "^0.3.0"
  },
  "devDependencies": {
    "smoltalk": "workspace:*",
    "jsdom": "^25.0.0"
  }
}
```

Note: `vitest` and `typescript` are intentionally not listed — they're hoisted from the workspace root.

- [ ] **Step 2: Create `packages/smoltalk-webllm/tsconfig.json`** (copy from llama-cpp package)

```json
{
  "extends": "../smoltalk/tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./lib"
  },
  "include": ["lib/**/*.ts"],
  "exclude": ["node_modules", "dist", "lib/**/*.test.ts"]
}
```

- [ ] **Step 3: Create `packages/smoltalk-webllm/makefile`** (lowercase)

```make
.PHONY: all test publish

all:
	pnpm run build

test:
	pnpm run test

publish: all
	pnpm publish
```

- [ ] **Step 4: Create `packages/smoltalk-webllm/lib/index.ts` as an empty placeholder**

```typescript
export {};
```

- [ ] **Step 5: Create `packages/smoltalk-webllm/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["lib/**/*.test.ts"],
  },
});
```

- [ ] **Step 6: Create `packages/smoltalk-webllm/README.md`**

Mirror the `smoltalk-llama-cpp` README's pattern: explicit `registerProvider` call + `provider: "webllm"` in the text() config.

```markdown
# smoltalk-webllm

WebGPU-accelerated browser provider for [smoltalk](../smoltalk). Runs LLMs locally in the user's browser via [@mlc-ai/web-llm](https://github.com/mlc-ai/web-llm).

## Install

```bash
pnpm add smoltalk smoltalk-webllm
```

## Usage

Register the provider before your first call, then use `smoltalk` normally:

```ts
import { registerProvider, text, userMessage } from "smoltalk";
import { WebLLMClient, loadModel } from "smoltalk-webllm";

registerProvider("webllm", WebLLMClient);

await loadModel("Llama-3.2-3B-Instruct-q4f32_1-MLC", {
  onProgress: (p) => console.log(p.text, p.loaded, p.total),
});

const result = await text({
  model: "Llama-3.2-3B-Instruct-q4f32_1-MLC",
  provider: "webllm",
  messages: [userMessage("Hello")],
});
```

The model id must match a record in WebLLM's `prebuiltAppConfig.model_list`. To see all available models:

```ts
import { listModels } from "smoltalk-webllm";
console.log(listModels()); // ["Llama-3.2-1B-Instruct-q4f32_1-MLC", ...]
```

## Custom models

Pass a `CustomModel` object to `loadModel` to load a model not in the prebuilt list:

```ts
await loadModel({
  id: "MyLlama-3b",
  modelUrl: "https://huggingface.co/.../resolve/main/",
  modelLibUrl: "https://.../mymodel.wasm",
  contextWindow: 4096,
});
```

## Limitations

- **WebGPU required**: throws `SmolError` at `loadModel()` time if `navigator.gpu` is undefined.
- **AbortSignal**: passing a `signal` to `loadModel` will reject the returned promise on abort, but the underlying download/compile may continue in the background. The engine will be unloaded if it eventually arrives.
```

- [ ] **Step 7: Install dependencies**

Run from repo root: `pnpm install`
Expected: pnpm links `smoltalk` workspace, installs `@mlc-ai/web-llm`, `jsdom`. (vitest/typescript are already in the lockfile from the root.)

- [ ] **Step 8: Verify build runs (will produce empty dist)**

Run: `pnpm --filter smoltalk-webllm build`
Expected: succeeds; `packages/smoltalk-webllm/dist/index.js` exists.

- [ ] **Step 9: Commit**

```bash
git add packages/smoltalk-webllm
git commit -m "scaffold smoltalk-webllm package"
```

---

## Task 2: Add types module

**Files:**
- Create: `packages/smoltalk-webllm/lib/types.ts`

- [ ] **Step 1: Write the file**

```typescript
export type LoadProgress = {
  stage: "downloading" | "compiling" | "ready";
  loaded: number;
  total: number;
  text?: string;
};

export type LoadOptions = {
  onProgress?: (p: LoadProgress) => void;
  signal?: AbortSignal;
};

export type CustomModel = {
  id: string;
  modelUrl: string;
  modelLibUrl: string;
  contextWindow: number;
  maxOutputTokens?: number;
};

export type LoadInput = string | CustomModel;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter smoltalk-webllm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/smoltalk-webllm/lib/types.ts
git commit -m "add LoadOptions/LoadProgress/CustomModel types"
```

---

## Task 3: Engine module — registry + getEngine + unloadModel

**Files:**
- Create: `packages/smoltalk-webllm/lib/engine.ts`
- Create: `packages/smoltalk-webllm/lib/engine.test.ts`

The engine module keeps a module-level `Map<modelId, MLCEngine>` and exposes synchronous lookup. `loadModel` is implemented in the next task; for this task we only need the registry mechanics, exposed via test-only setters so we can write fast tests without spinning up a real engine.

- [ ] **Step 1: Write the failing test**

```typescript
// lib/engine.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  getEngine,
  isLoaded,
  unloadModel,
  __setEngineForTesting,
  __clearEnginesForTesting,
} from "./engine.js";

describe("engine registry", () => {
  beforeEach(() => __clearEnginesForTesting());

  it("isLoaded returns false when no engine is registered", () => {
    expect(isLoaded("foo")).toBe(false);
  });

  it("getEngine throws a helpful error when no engine is loaded", () => {
    expect(() => getEngine("foo")).toThrow(
      /Model not loaded: call loadModel\("foo"\) first/,
    );
  });

  it("isLoaded and getEngine return the registered engine", () => {
    const fake = { id: "stub" } as any;
    __setEngineForTesting("foo", fake);
    expect(isLoaded("foo")).toBe(true);
    expect(getEngine("foo")).toBe(fake);
  });
});

describe("unloadModel", () => {
  beforeEach(() => __clearEnginesForTesting());

  it("calls engine.unload() and removes it from the registry", async () => {
    let unloaded = false;
    const fake = {
      unload: async () => {
        unloaded = true;
      },
    } as any;
    __setEngineForTesting("a", fake);
    await unloadModel("a");
    expect(unloaded).toBe(true);
    expect(isLoaded("a")).toBe(false);
  });

  it("is a no-op when the model is not loaded", async () => {
    await expect(unloadModel("nope")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --filter smoltalk-webllm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/engine.ts` (registry only — load comes next task)**

```typescript
import type { MLCEngine } from "@mlc-ai/web-llm";
import { SmolError } from "smoltalk";

const engines = new Map<string, MLCEngine>();

export function getEngine(id: string): MLCEngine {
  const e = engines.get(id);
  if (!e) {
    throw new SmolError(
      `Model not loaded: call loadModel("${id}") first`,
    );
  }
  return e;
}

export function isLoaded(id: string): boolean {
  return engines.has(id);
}

export async function unloadModel(id: string): Promise<void> {
  const e = engines.get(id);
  if (e) {
    await e.unload();
    engines.delete(id);
  }
}

/** @internal — test-only */
export function __setEngineForTesting(id: string, engine: MLCEngine): void {
  engines.set(id, engine);
}

/** @internal — test-only */
export function __clearEnginesForTesting(): void {
  engines.clear();
}

/** @internal */
export function __getEngineMap(): Map<string, MLCEngine> {
  return engines;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter smoltalk-webllm test`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/smoltalk-webllm/lib/engine.ts packages/smoltalk-webllm/lib/engine.test.ts
git commit -m "add webllm engine registry"
```

---

## Task 4: Engine module — loadModel (with WebGPU check, AbortSignal, dynamic import)

**Files:**
- Modify: `packages/smoltalk-webllm/lib/engine.ts`
- Modify: `packages/smoltalk-webllm/lib/engine.test.ts`

This task adds the actual `loadModel` function. We don't want tests that download real models, so we'll inject a factory that the test can stub. We also:
- Throw early `SmolError` if `navigator.gpu` is undefined.
- Honor `LoadOptions.signal` — if the abort fires, reject the returned promise; if the engine eventually arrives anyway, unload it to free GPU memory.
- Use a dynamic `import("@mlc-ai/web-llm")` inside the default factory so this package is safe to import in SSR/Node contexts without immediately blowing up on browser globals.

- [ ] **Step 1: Add failing tests to `engine.test.ts`**

Append:

```typescript
import {
  loadModel,
  __setEngineFactoryForTesting,
} from "./engine.js";

const withGpu = () => {
  (globalThis as any).navigator = { gpu: {} };
};
const withoutGpu = () => {
  (globalThis as any).navigator = {};
};

describe("loadModel", () => {
  beforeEach(() => {
    __clearEnginesForTesting();
    withGpu();
  });

  it("throws SmolError when WebGPU is not available", async () => {
    withoutGpu();
    await expect(
      loadModel("Llama-3.2-1B-Instruct-q4f32_1-MLC"),
    ).rejects.toThrow(/WebGPU is not available/);
  });

  it("invokes the factory with the string model id and stores the engine", async () => {
    const stub = { unload: async () => {} } as any;
    let receivedId: string | null = null;
    __setEngineFactoryForTesting(async (id, _opts) => {
      receivedId = id;
      return stub;
    });
    await loadModel("Llama-3.2-1B-Instruct-q4f32_1-MLC");
    expect(receivedId).toBe("Llama-3.2-1B-Instruct-q4f32_1-MLC");
    expect(isLoaded("Llama-3.2-1B-Instruct-q4f32_1-MLC")).toBe(true);
  });

  it("dedupes concurrent loads of the same model", async () => {
    let calls = 0;
    __setEngineFactoryForTesting(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return { unload: async () => {} } as any;
    });
    await Promise.all([loadModel("a"), loadModel("a"), loadModel("a")]);
    expect(calls).toBe(1);
  });

  it("is a no-op when the model is already loaded", async () => {
    let calls = 0;
    __setEngineFactoryForTesting(async () => {
      calls++;
      return { unload: async () => {} } as any;
    });
    await loadModel("a");
    await loadModel("a");
    expect(calls).toBe(1);
  });

  it("accepts a CustomModel object and uses its id", async () => {
    let received: any = null;
    __setEngineFactoryForTesting(async (id, _opts, custom) => {
      received = { id, custom };
      return { unload: async () => {} } as any;
    });
    await loadModel({
      id: "my-custom",
      modelUrl: "https://x/y",
      modelLibUrl: "https://x/z",
      contextWindow: 4096,
    });
    expect(received.id).toBe("my-custom");
    expect(received.custom.modelUrl).toBe("https://x/y");
    expect(isLoaded("my-custom")).toBe(true);
  });

  it("forwards progress callbacks", async () => {
    const progressSeen: any[] = [];
    __setEngineFactoryForTesting(async (_id, opts) => {
      opts?.onProgress?.({
        stage: "downloading",
        loaded: 50,
        total: 100,
        text: "x",
      });
      return { unload: async () => {} } as any;
    });
    await loadModel("a", { onProgress: (p) => progressSeen.push(p) });
    expect(progressSeen).toHaveLength(1);
    expect(progressSeen[0].stage).toBe("downloading");
    expect(progressSeen[0].loaded).toBe(50);
  });

  it("rejects with abort error when signal fires", async () => {
    let resolveFactory: (e: any) => void = () => {};
    __setEngineFactoryForTesting(
      () =>
        new Promise<any>((resolve) => {
          resolveFactory = resolve;
        }),
    );
    const ctrl = new AbortController();
    const p = loadModel("a", { signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toThrow(/aborted/i);
    // simulate the late-arriving engine; it must NOT end up in the registry
    let unloaded = false;
    resolveFactory({
      unload: async () => {
        unloaded = true;
      },
    });
    // give the late-unload microtask a tick
    await new Promise((r) => setTimeout(r, 0));
    expect(isLoaded("a")).toBe(false);
    expect(unloaded).toBe(true);
  });

  it("rejects immediately if signal is already aborted", async () => {
    __setEngineFactoryForTesting(async () => ({ unload: async () => {} }) as any);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(loadModel("a", { signal: ctrl.signal })).rejects.toThrow(/aborted/i);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm --filter smoltalk-webllm test`
Expected: FAIL — `loadModel`, `__setEngineFactoryForTesting` not exported.

- [ ] **Step 3: Extend `lib/engine.ts` with loadModel and the factory injection point**

Append to the existing file:

```typescript
import type {
  CustomModel,
  LoadOptions,
  LoadProgress,
  LoadInput,
} from "./types.js";

type EngineFactory = (
  id: string,
  opts: LoadOptions | undefined,
  custom: CustomModel | undefined,
) => Promise<MLCEngine>;

// Lazy import of @mlc-ai/web-llm — keeps this package SSR-safe.
// The browser-global references (navigator, WebGPU, etc.) inside web-llm
// only get evaluated when loadModel() is actually called.
const defaultFactory: EngineFactory = async (id, opts, custom) => {
  const webllm = await import("@mlc-ai/web-llm");
  const initProgressCallback = (r: any) => {
    opts?.onProgress?.(normalizeProgress(r));
  };
  if (custom) {
    return webllm.CreateMLCEngine(id, {
      initProgressCallback,
      appConfig: {
        model_list: [
          {
            model: custom.modelUrl,
            model_id: id,
            model_lib: custom.modelLibUrl,
          },
        ],
      },
    } as any);
  }
  return webllm.CreateMLCEngine(id, { initProgressCallback });
};

let factory: EngineFactory = defaultFactory;
const loading = new Map<string, Promise<MLCEngine>>();

export async function loadModel(
  input: LoadInput,
  opts?: LoadOptions,
): Promise<void> {
  if (!(globalThis as any).navigator?.gpu) {
    throw new SmolError(
      "WebGPU is not available in this environment. " +
        "smoltalk-webllm requires a browser with WebGPU support.",
    );
  }

  const id = typeof input === "string" ? input : input.id;
  const custom = typeof input === "string" ? undefined : input;

  if (engines.has(id)) return;
  if (loading.has(id)) {
    await loading.get(id);
    return;
  }

  if (opts?.signal?.aborted) {
    throw new SmolError("Model load aborted");
  }

  const factoryPromise = factory(id, opts, custom);
  loading.set(id, factoryPromise);

  // Race the load against an abort; if abort wins, also unload the engine
  // when it eventually arrives so we don't leak GPU memory.
  if (opts?.signal) {
    const signal = opts.signal;
    const abortPromise = new Promise<never>((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new SmolError("Model load aborted")),
        { once: true },
      );
    });

    // Cleanup the engine if it arrives after abort.
    factoryPromise
      .then((engine) => {
        if (signal.aborted && !engines.has(id)) {
          engine.unload().catch(() => {});
        }
      })
      .catch(() => {});

    try {
      const engine = await Promise.race([factoryPromise, abortPromise]);
      engines.set(id, engine);
    } finally {
      loading.delete(id);
    }
    return;
  }

  try {
    const engine = await factoryPromise;
    engines.set(id, engine);
  } finally {
    loading.delete(id);
  }
}

function normalizeProgress(r: { progress?: number; text?: string }): LoadProgress {
  const text = r.text ?? "";
  const progress = r.progress ?? 0;
  const stage: LoadProgress["stage"] =
    progress >= 1
      ? "ready"
      : /compil|load.*model/i.test(text)
        ? "compiling"
        : "downloading";
  return {
    stage,
    loaded: Math.round(progress * 100),
    total: 100,
    text,
  };
}

/** @internal — test-only */
export function __setEngineFactoryForTesting(f: EngineFactory): void {
  factory = f;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `pnpm --filter smoltalk-webllm test`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/smoltalk-webllm/lib/engine.ts packages/smoltalk-webllm/lib/engine.test.ts
git commit -m "add loadModel with WebGPU check, AbortSignal, lazy import"
```

---

## Task 5: Add listModels() helper (passthrough to web-llm prebuilt list)

Rather than maintain a parallel curated registry, expose WebLLM's own `prebuiltAppConfig.model_list` so users can discover what's available. This stays in sync automatically as `@mlc-ai/web-llm` versions bump.

**Files:**
- Modify: `packages/smoltalk-webllm/lib/engine.ts`
- Create: `packages/smoltalk-webllm/lib/models.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/models.test.ts
import { describe, it, expect, vi } from "vitest";

describe("listModels", () => {
  it("returns the model ids from web-llm's prebuiltAppConfig", async () => {
    vi.doMock("@mlc-ai/web-llm", () => ({
      prebuiltAppConfig: {
        model_list: [
          { model_id: "Llama-3.2-1B-Instruct-q4f32_1-MLC" },
          { model_id: "Phi-3.5-mini-instruct-q4f32_1-MLC" },
        ],
      },
    }));
    const { listModels } = await import("./engine.js");
    const ids = await listModels();
    expect(ids).toContain("Llama-3.2-1B-Instruct-q4f32_1-MLC");
    expect(ids).toContain("Phi-3.5-mini-instruct-q4f32_1-MLC");
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --filter smoltalk-webllm test`
Expected: FAIL — `listModels` not exported.

- [ ] **Step 3: Add `listModels` and `isWebLLMModel` to `lib/engine.ts`**

Append:

```typescript
/**
 * Returns the model IDs available in the underlying @mlc-ai/web-llm prebuilt
 * config. Lazily imports web-llm so this is SSR-safe.
 */
export async function listModels(): Promise<string[]> {
  const webllm = await import("@mlc-ai/web-llm");
  return webllm.prebuiltAppConfig.model_list.map((m: any) => m.model_id);
}

/** Returns true if the given id is in web-llm's prebuilt model list. */
export async function isWebLLMModel(id: string): Promise<boolean> {
  const ids = await listModels();
  return ids.includes(id);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `pnpm --filter smoltalk-webllm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/smoltalk-webllm/lib/engine.ts packages/smoltalk-webllm/lib/models.test.ts
git commit -m "add listModels()/isWebLLMModel() passthroughs"
```

---

## Task 6: WebLLMClient — text completion through the public API (no tools, no structured output)

**Files:**
- Create: `packages/smoltalk-webllm/lib/client.ts`
- Create: `packages/smoltalk-webllm/lib/client.test.ts`

Tests drive `client.textSync(config)` (the public method on `BaseClient`), which internally calls our `_textSync`. This exercises the same code path users will hit.

- [ ] **Step 1: Write the failing test**

```typescript
// lib/client.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  __setEngineForTesting,
  __clearEnginesForTesting,
} from "./engine.js";
import { WebLLMClient } from "./client.js";
import { userMessage } from "smoltalk";

function fakeEngine(opts: {
  content?: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
}) {
  return {
    chat: {
      completions: {
        create: async (_args: any) => ({
          choices: [
            {
              message: { role: "assistant", content: opts.content ?? "hi" },
              finish_reason: "stop",
            },
          ],
          usage: opts.usage ?? { prompt_tokens: 3, completion_tokens: 2 },
        }),
      },
    },
    unload: async () => {},
  } as any;
}

describe("WebLLMClient.textSync — plain text", () => {
  beforeEach(() => __clearEnginesForTesting());

  it("returns the assistant text from the engine", async () => {
    __setEngineForTesting("m", fakeEngine({ content: "hello world" }));
    const client = new WebLLMClient({
      provider: "webllm",
      model: "m",
      messages: [userMessage("Say hi")],
    });
    const result = await client.textSync({
      provider: "webllm",
      model: "m",
      messages: [userMessage("Say hi")],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.output).toBe("hello world");
      expect(result.value.model).toBe("m");
    }
  });

  it("populates token usage and a zero-cost CostEstimate", async () => {
    __setEngineForTesting(
      "m",
      fakeEngine({ usage: { prompt_tokens: 11, completion_tokens: 7 } }),
    );
    const client = new WebLLMClient({
      provider: "webllm",
      model: "m",
      messages: [userMessage("hi")],
    });
    const result = await client.textSync({
      provider: "webllm",
      model: "m",
      messages: [userMessage("hi")],
    });
    if (result.success) {
      expect(result.value.usage?.inputTokens).toBe(11);
      expect(result.value.usage?.outputTokens).toBe(7);
      expect(result.value.cost?.inputCost).toBe(0);
      expect(result.value.cost?.outputCost).toBe(0);
      expect(result.value.cost?.totalCost).toBe(0);
      expect(result.value.cost?.currency).toBe("USD");
    }
  });

  it("passes converted OpenAI-format messages to the engine", async () => {
    let received: any = null;
    __setEngineForTesting("m", {
      chat: {
        completions: {
          create: async (args: any) => {
            received = args;
            return {
              choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            };
          },
        },
      },
      unload: async () => {},
    } as any);
    const client = new WebLLMClient({
      provider: "webllm",
      model: "m",
      messages: [userMessage("hello")],
    });
    await client.textSync({
      provider: "webllm",
      model: "m",
      messages: [userMessage("hello")],
    });
    expect(received.messages).toHaveLength(1);
    expect(received.messages[0].role).toBe("user");
    expect(received.messages[0].content).toBe("hello");
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --filter smoltalk-webllm test`
Expected: FAIL — `WebLLMClient` not exported.

- [ ] **Step 3: Implement `lib/client.ts`**

```typescript
import {
  BaseClient,
  PromptResult,
  Result,
  SmolConfig,
  StreamChunk,
  success,
} from "smoltalk";
import { getEngine } from "./engine.js";

const ZERO_COST = { inputCost: 0, outputCost: 0, totalCost: 0, currency: "USD" };

export class WebLLMClient extends BaseClient {
  async _textSync(promptConfig: SmolConfig): Promise<Result<PromptResult>> {
    const engine = getEngine(promptConfig.model);
    const messages = promptConfig.messages.map((m) => m.toOpenAIMessage());

    const response: any = await engine.chat.completions.create({
      messages: messages as any,
      temperature: promptConfig.temperature,
      max_tokens: promptConfig.maxTokens,
    } as any);

    const choice = response.choices?.[0];
    const content: string | null = choice?.message?.content ?? null;
    const usage = response.usage;

    return success({
      output: content,
      toolCalls: [],
      model: promptConfig.model,
      usage: usage
        ? {
            inputTokens: usage.prompt_tokens ?? 0,
            outputTokens: usage.completion_tokens ?? 0,
          }
        : undefined,
      cost: { ...ZERO_COST },
    });
  }

  async *_textStream(_promptConfig: SmolConfig): AsyncGenerator<StreamChunk> {
    throw new Error("Not yet implemented — see Task 7");
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter smoltalk-webllm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/smoltalk-webllm/lib/client.ts packages/smoltalk-webllm/lib/client.test.ts
git commit -m "implement WebLLMClient._textSync for plain text"
```

---

## Task 7: WebLLMClient — _textStream

**Files:**
- Modify: `packages/smoltalk-webllm/lib/client.ts`
- Modify: `packages/smoltalk-webllm/lib/client.test.ts`

- [ ] **Step 1: Add failing test**

Append to `client.test.ts`:

```typescript
describe("WebLLMClient.textStream", () => {
  beforeEach(() => __clearEnginesForTesting());

  it("yields text chunks then a done chunk", async () => {
    __setEngineForTesting("m", {
      chat: {
        completions: {
          create: async (_args: any) => {
            async function* gen() {
              yield {
                choices: [{ delta: { content: "Hel" }, finish_reason: null }],
              };
              yield {
                choices: [{ delta: { content: "lo" }, finish_reason: null }],
              };
              yield {
                choices: [{ delta: {}, finish_reason: "stop" }],
                usage: { prompt_tokens: 2, completion_tokens: 2 },
              };
            }
            return gen();
          },
        },
      },
      unload: async () => {},
    } as any);

    const client = new WebLLMClient({
      provider: "webllm",
      model: "m",
      messages: [userMessage("hi")],
    });
    const chunks: any[] = [];
    for await (const c of client.textStream({
      provider: "webllm",
      model: "m",
      messages: [userMessage("hi")],
    })) {
      chunks.push(c);
    }
    const text = chunks.filter((c) => c.type === "text").map((c) => c.text);
    expect(text.join("")).toBe("Hello");
    const last = chunks[chunks.length - 1];
    expect(last.type).toBe("done");
    expect(last.result.output).toBe("Hello");
    expect(last.result.usage?.inputTokens).toBe(2);
    expect(last.result.cost?.currency).toBe("USD");
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `pnpm --filter smoltalk-webllm test`
Expected: FAIL — `_textStream` throws "Not yet implemented".

- [ ] **Step 3: Replace `_textStream` in `lib/client.ts`**

```typescript
  async *_textStream(promptConfig: SmolConfig): AsyncGenerator<StreamChunk> {
    const engine = getEngine(promptConfig.model);
    const messages = promptConfig.messages.map((m) => m.toOpenAIMessage());

    const stream: any = await engine.chat.completions.create({
      messages: messages as any,
      temperature: promptConfig.temperature,
      max_tokens: promptConfig.maxTokens,
      stream: true,
    } as any);

    let outputText = "";
    let usage: { prompt_tokens: number; completion_tokens: number } | undefined;

    for await (const chunk of stream as AsyncIterable<any>) {
      const choice = chunk.choices?.[0];
      const deltaText: string | undefined = choice?.delta?.content;
      if (deltaText) {
        outputText += deltaText;
        yield { type: "text", text: deltaText };
      }
      if (chunk.usage) usage = chunk.usage;
    }

    yield {
      type: "done",
      result: {
        output: outputText || null,
        toolCalls: [],
        model: promptConfig.model,
        usage: usage
          ? {
              inputTokens: usage.prompt_tokens ?? 0,
              outputTokens: usage.completion_tokens ?? 0,
            }
          : undefined,
        cost: { ...ZERO_COST },
      },
    };
  }
```

- [ ] **Step 4: Run test to confirm it passes**

Run: `pnpm --filter smoltalk-webllm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/smoltalk-webllm/lib/client.ts packages/smoltalk-webllm/lib/client.test.ts
git commit -m "implement WebLLMClient._textStream"
```

---

## Task 8: WebLLMClient — tool calls (sync + stream)

**Files:**
- Modify: `packages/smoltalk-webllm/lib/client.ts`
- Modify: `packages/smoltalk-webllm/lib/client.test.ts`

WebLLM's API is OpenAI-shaped, so we can reuse `zodToOpenAITool` from smoltalk core.

- [ ] **Step 1: Write failing tests**

Append to `client.test.ts`:

```typescript
import { z } from "zod";

describe("WebLLMClient tool calls — sync", () => {
  beforeEach(() => __clearEnginesForTesting());

  it("returns toolCalls from the engine response", async () => {
    __setEngineForTesting("m", {
      chat: {
        completions: {
          create: async (_args: any) => ({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "get_weather",
                        arguments: JSON.stringify({ city: "Paris" }),
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 3 },
          }),
        },
      },
      unload: async () => {},
    } as any);

    const config = {
      provider: "webllm" as const,
      model: "m",
      messages: [userMessage("weather?")],
      tools: [
        {
          name: "get_weather",
          description: "weather",
          parameters: z.object({ city: z.string() }),
          handler: async () => "sunny",
        },
      ],
    };
    const client = new WebLLMClient(config);
    const result = await client.textSync(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.toolCalls).toHaveLength(1);
      expect(result.value.toolCalls[0].name).toBe("get_weather");
      expect(result.value.toolCalls[0].arguments).toEqual({ city: "Paris" });
    }
  });

  it("forwards tools to the engine in OpenAI shape", async () => {
    let received: any = null;
    __setEngineForTesting("m", {
      chat: {
        completions: {
          create: async (args: any) => {
            received = args;
            return {
              choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            };
          },
        },
      },
      unload: async () => {},
    } as any);
    const config = {
      provider: "webllm" as const,
      model: "m",
      messages: [userMessage("hi")],
      tools: [
        {
          name: "t",
          description: "d",
          parameters: z.object({ x: z.string() }),
          handler: async () => "ok",
        },
      ],
    };
    const client = new WebLLMClient(config);
    await client.textSync(config);
    expect(received.tools).toBeDefined();
    expect(received.tools[0].function.name).toBe("t");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm --filter smoltalk-webllm test`
Expected: FAIL.

- [ ] **Step 3: Update `_textSync` and `_textStream` in `lib/client.ts` to handle tools**

Add `ToolCall` and `zodToOpenAITool` imports. Replace `_textSync` and `_textStream` to forward `tools` and parse `tool_calls` from the response.

```typescript
import {
  BaseClient,
  PromptResult,
  Result,
  SmolConfig,
  StreamChunk,
  ToolCall,
  success,
  zodToOpenAITool,
} from "smoltalk";
import { getEngine } from "./engine.js";

const ZERO_COST = { inputCost: 0, outputCost: 0, totalCost: 0, currency: "USD" };

function buildTools(promptConfig: SmolConfig) {
  if (!promptConfig.tools?.length) return undefined;
  return promptConfig.tools.map((t) =>
    zodToOpenAITool(t.name, t.parameters, { description: t.description }),
  );
}

export class WebLLMClient extends BaseClient {
  async _textSync(promptConfig: SmolConfig): Promise<Result<PromptResult>> {
    const engine = getEngine(promptConfig.model);
    const messages = promptConfig.messages.map((m) => m.toOpenAIMessage());
    const tools = buildTools(promptConfig);

    const response: any = await engine.chat.completions.create({
      messages: messages as any,
      tools: tools as any,
      temperature: promptConfig.temperature,
      max_tokens: promptConfig.maxTokens,
    } as any);

    const choice = response.choices?.[0];
    const content: string | null = choice?.message?.content ?? null;
    const rawToolCalls = choice?.message?.tool_calls ?? [];
    const toolCalls: ToolCall[] = rawToolCalls.map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      arguments:
        typeof tc.function.arguments === "string"
          ? JSON.parse(tc.function.arguments)
          : tc.function.arguments,
    }));
    const usage = response.usage;

    return success({
      output: content,
      toolCalls,
      model: promptConfig.model,
      usage: usage
        ? {
            inputTokens: usage.prompt_tokens ?? 0,
            outputTokens: usage.completion_tokens ?? 0,
          }
        : undefined,
      cost: { ...ZERO_COST },
    });
  }

  async *_textStream(promptConfig: SmolConfig): AsyncGenerator<StreamChunk> {
    const engine = getEngine(promptConfig.model);
    const messages = promptConfig.messages.map((m) => m.toOpenAIMessage());
    const tools = buildTools(promptConfig);

    const stream: any = await engine.chat.completions.create({
      messages: messages as any,
      tools: tools as any,
      temperature: promptConfig.temperature,
      max_tokens: promptConfig.maxTokens,
      stream: true,
    } as any);

    let outputText = "";
    let usage: { prompt_tokens: number; completion_tokens: number } | undefined;
    const toolCallBufs = new Map<
      number,
      { id?: string; name?: string; args: string }
    >();

    for await (const chunk of stream as AsyncIterable<any>) {
      const choice = chunk.choices?.[0];
      const deltaText: string | undefined = choice?.delta?.content;
      if (deltaText) {
        outputText += deltaText;
        yield { type: "text", text: deltaText };
      }

      const deltaTools = choice?.delta?.tool_calls ?? [];
      for (const dt of deltaTools) {
        const idx: number = dt.index ?? 0;
        const buf = toolCallBufs.get(idx) ?? { args: "" };
        if (dt.id) buf.id = dt.id;
        if (dt.function?.name) buf.name = dt.function.name;
        if (dt.function?.arguments) buf.args += dt.function.arguments;
        toolCallBufs.set(idx, buf);
      }

      if (chunk.usage) usage = chunk.usage;
    }

    const toolCalls: ToolCall[] = [];
    for (const buf of toolCallBufs.values()) {
      if (!buf.name) continue;
      const parsed = buf.args ? JSON.parse(buf.args) : {};
      const tc: ToolCall = { id: buf.id ?? "", name: buf.name, arguments: parsed };
      toolCalls.push(tc);
      yield { type: "tool_call", toolCall: tc };
    }

    yield {
      type: "done",
      result: {
        output: outputText || null,
        toolCalls,
        model: promptConfig.model,
        usage: usage
          ? {
              inputTokens: usage.prompt_tokens ?? 0,
              outputTokens: usage.completion_tokens ?? 0,
            }
          : undefined,
        cost: { ...ZERO_COST },
      },
    };
  }
}
```

- [ ] **Step 4: Run all tests**

Run: `pnpm --filter smoltalk-webllm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/smoltalk-webllm/lib/client.ts packages/smoltalk-webllm/lib/client.test.ts
git commit -m "add tool call support to WebLLMClient"
```

---

## Task 9: WebLLMClient — structured output (JSON / Zod)

**Files:**
- Modify: `packages/smoltalk-webllm/lib/client.ts`
- Modify: `packages/smoltalk-webllm/lib/client.test.ts`

WebLLM accepts an OpenAI-shaped `response_format`. Use zod 4's built-in `schema.toJSONSchema()` (the same call smoltalk core makes in `openai.ts`).

- [ ] **Step 1: Write failing test**

Append to `client.test.ts`:

```typescript
describe("WebLLMClient structured output", () => {
  beforeEach(() => __clearEnginesForTesting());

  it("forwards response_format when responseFormat is a Zod schema", async () => {
    let received: any = null;
    __setEngineForTesting("m", {
      chat: {
        completions: {
          create: async (args: any) => {
            received = args;
            return {
              choices: [
                {
                  message: { content: JSON.stringify({ x: "hi" }) },
                  finish_reason: "stop",
                },
              ],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            };
          },
        },
      },
      unload: async () => {},
    } as any);

    const config = {
      provider: "webllm" as const,
      model: "m",
      messages: [userMessage("hi")],
      responseFormat: z.object({ x: z.string() }),
    };
    const client = new WebLLMClient(config);
    await client.textSync(config);
    expect(received.response_format).toBeDefined();
    expect(received.response_format.type).toBe("json_schema");
    expect(received.response_format.json_schema.schema).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `pnpm --filter smoltalk-webllm test`
Expected: FAIL.

- [ ] **Step 3: Update `_textSync` and `_textStream` to forward `response_format`**

Add a helper near the top of `client.ts`:

```typescript
function buildResponseFormat(config: SmolConfig): any | undefined {
  if (!config.responseFormat) return undefined;
  return {
    type: "json_schema",
    json_schema: {
      name: config.responseFormatOptions?.name || "response",
      schema: config.responseFormat.toJSONSchema(),
    },
  };
}
```

Then in both `_textSync` and `_textStream`'s `create()` arg objects, add:

```typescript
      response_format: buildResponseFormat(promptConfig),
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `pnpm --filter smoltalk-webllm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/smoltalk-webllm/lib/client.ts packages/smoltalk-webllm/lib/client.test.ts
git commit -m "forward responseFormat as response_format to WebLLM engine"
```

---

## Task 10: Public exports

**Files:**
- Modify: `packages/smoltalk-webllm/lib/index.ts`

- [ ] **Step 1: Update `lib/index.ts`**

```typescript
export { WebLLMClient } from "./client.js";
export {
  loadModel,
  unloadModel,
  isLoaded,
  getEngine,
  listModels,
  isWebLLMModel,
} from "./engine.js";
export type {
  LoadOptions,
  LoadProgress,
  CustomModel,
  LoadInput,
} from "./types.js";
```

- [ ] **Step 2: Typecheck and build**

Run: `pnpm --filter smoltalk-webllm typecheck && pnpm --filter smoltalk-webllm build`
Expected: both succeed.

- [ ] **Step 3: Confirm exports**

Run: `cat packages/smoltalk-webllm/dist/index.d.ts`
Expected: declares `WebLLMClient`, `loadModel`, `unloadModel`, `isLoaded`, `getEngine`, `listModels`, `isWebLLMModel`, plus the type exports.

- [ ] **Step 4: Commit**

```bash
git add packages/smoltalk-webllm/lib/index.ts
git commit -m "add public exports for smoltalk-webllm"
```

---

## Task 11: Wire smoltalk-webllm into the root makefile

**Files:**
- Modify: `makefile` (repo root, lowercase)

- [ ] **Step 1: Inspect the current root makefile**

Run: `cat makefile`

- [ ] **Step 2: Add `packages/smoltalk-webllm` to the `PACKAGES` list**

Change:
```make
PACKAGES := packages/smoltalk packages/smoltalk-llama-cpp
```
to:
```make
PACKAGES := packages/smoltalk packages/smoltalk-llama-cpp packages/smoltalk-webllm
```

- [ ] **Step 3: Verify**

Run: `make test`
Expected: tests for smoltalk, smoltalk-llama-cpp, and smoltalk-webllm all run.

- [ ] **Step 4: Commit**

```bash
git add makefile
git commit -m "include smoltalk-webllm in root make targets"
```

---

## Task 12: Update root CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (repo root)

- [ ] **Step 1: Add `smoltalk-webllm` to the Project Overview section**

Update the bullet list under "This repo is a pnpm workspace monorepo:" to include the new package, e.g.:

```markdown
- `packages/smoltalk-webllm/` — `@mlc-ai/web-llm` plugin for browser/WebGPU inference
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "document smoltalk-webllm in root CLAUDE.md"
```

---

## Task 13: Final verification

- [ ] **Step 1: Run typecheck, tests, build across the workspace**

```bash
pnpm typecheck
pnpm test
pnpm build
```

Expected: all succeed.

- [ ] **Step 2: Spot-check the README example compiles**

Open `packages/smoltalk-webllm/README.md` and walk through the usage example against the actual exports. Fix wording if anything is off.

- [ ] **Step 3: Final commit if anything was tweaked**

```bash
git status
# only commit if there are changes
git add -A && git commit -m "polish smoltalk-webllm public API"
```

---

## Notes for the implementer

- **`as any` casts on engine arguments:** WebLLM's TypeScript types are sometimes stricter than the runtime accepts. The `as any` casts in the create() calls are intentional to keep this plan moving; tighten them later if it bothers you.
- **No integration tests:** This plan covers only unit tests with mocked engines. A real end-to-end smoke test against an actual WebLLM model is deferred to a follow-up (it requires multi-GB downloads and a real browser).
- **AbortSignal limitation:** The `signal` cancels the *outer* promise but the underlying download/compile may continue in the background. We unload the engine when it eventually arrives so we don't leak GPU memory. This limitation is documented in the README.
- **SSR safety:** `@mlc-ai/web-llm` is dynamically imported inside `defaultFactory` so this package is safe to import in Node/SSR contexts as long as `loadModel()` is never called there.
- **Follow-up plan:** `smoltalk-wllama` is a separate plan that will follow this one. The wllama work is meaningfully different (no native tool calls, GBNF grammars for structured output, GGUF loading from URLs) and deserves its own plan.
