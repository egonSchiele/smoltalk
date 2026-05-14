# smoltalk-webllm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new workspace package `smoltalk-webllm` that lets smoltalk users run LLMs in the browser via WebGPU, using `@mlc-ai/web-llm` under the hood. Mirrors the existing `smoltalk-llama-cpp` plugin pattern.

**Architecture:** Single-runtime plugin package that extends `BaseClient` from smoltalk core. Provides explicit `loadModel`/`unloadModel` lifecycle, a module-level engine registry keyed by model ID, and a `register()` helper that calls `registerProvider("webllm", WebLLMClient)`. ESM-only, browser-targeted, peer-depends on `smoltalk`.

**Tech Stack:** TypeScript (strict, ESNext, nodenext modules), pnpm workspaces, vitest (jsdom env), `@mlc-ai/web-llm`, `zod`.

**Spec:** `docs/superpowers/specs/2026-05-13-browser-packages-design.md`

---

## Files

**Created:**
- `packages/smoltalk-webllm/package.json`
- `packages/smoltalk-webllm/tsconfig.json`
- `packages/smoltalk-webllm/Makefile`
- `packages/smoltalk-webllm/README.md`
- `packages/smoltalk-webllm/vitest.config.ts`
- `packages/smoltalk-webllm/lib/index.ts` — public exports
- `packages/smoltalk-webllm/lib/types.ts` — `LoadOptions`, `LoadProgress`, `CustomModel`
- `packages/smoltalk-webllm/lib/models.ts` — curated model registry
- `packages/smoltalk-webllm/lib/engine.ts` — `loadModel`, `unloadModel`, `getEngine`, `isLoaded`
- `packages/smoltalk-webllm/lib/client.ts` — `WebLLMClient extends BaseClient`
- `packages/smoltalk-webllm/lib/register.ts` — `register()` helper
- `packages/smoltalk-webllm/lib/engine.test.ts`
- `packages/smoltalk-webllm/lib/client.test.ts`
- `packages/smoltalk-webllm/lib/models.test.ts`
- `packages/smoltalk-webllm/lib/register.test.ts`

**Modified:**
- `Makefile` (repo root) — add `smoltalk-webllm` to recursion list

---

## Task 1: Scaffold the package

**Files:**
- Create: `packages/smoltalk-webllm/package.json`
- Create: `packages/smoltalk-webllm/tsconfig.json`
- Create: `packages/smoltalk-webllm/Makefile`
- Create: `packages/smoltalk-webllm/README.md`
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
      "import": "./dist/index.js"
    }
  },
  "types": "./dist/index.d.ts",
  "browser": "./dist/index.js",
  "keywords": ["smoltalk", "llm", "webllm", "webgpu", "browser", "local"],
  "license": "ISC",
  "dependencies": {
    "@mlc-ai/web-llm": "^0.2.79"
  },
  "peerDependencies": {
    "smoltalk": "^0.2.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "smoltalk": "workspace:*",
    "vitest": "^2.0.0",
    "jsdom": "^25.0.0",
    "typescript": "^5.5.0"
  }
}
```

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

- [ ] **Step 3: Create `packages/smoltalk-webllm/Makefile`**

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

- [ ] **Step 6: Create a minimal `packages/smoltalk-webllm/README.md`**

```markdown
# smoltalk-webllm

WebGPU-accelerated browser provider for [smoltalk](../smoltalk). Runs LLMs locally in the user's browser via [@mlc-ai/web-llm](https://github.com/mlc-ai/web-llm).

## Install

```bash
pnpm add smoltalk smoltalk-webllm
```

## Usage

```typescript
import { text } from "smoltalk";
import { register, loadModel } from "smoltalk-webllm";

register();
await loadModel("Llama-3.2-3B-Instruct-q4f32_1-MLC", {
  onProgress: (p) => console.log(p.text, p.loaded, p.total),
});

const result = await text("Hello", {
  model: "Llama-3.2-3B-Instruct-q4f32_1-MLC",
});
```
```

- [ ] **Step 7: Install dependencies**

Run from repo root: `pnpm install`
Expected: pnpm links `smoltalk` workspace, installs `@mlc-ai/web-llm`, `vitest`, `jsdom`.

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

## Task 3: Add curated model registry

**Files:**
- Create: `packages/smoltalk-webllm/lib/models.ts`
- Create: `packages/smoltalk-webllm/lib/models.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/models.test.ts
import { describe, it, expect } from "vitest";
import { models, isWebLLMModel } from "./models.js";

describe("webllm models registry", () => {
  it("contains at least one curated model", () => {
    expect(Object.keys(models).length).toBeGreaterThan(0);
  });

  it("every model has provider 'webllm' and a positive contextWindow", () => {
    for (const [id, m] of Object.entries(models)) {
      expect(m.provider).toBe("webllm");
      expect(m.contextWindow).toBeGreaterThan(0);
      expect(id).toBeTruthy();
    }
  });

  it("isWebLLMModel returns true for a registered model id", () => {
    const id = Object.keys(models)[0];
    expect(isWebLLMModel(id)).toBe(true);
  });

  it("isWebLLMModel returns false for an unknown id", () => {
    expect(isWebLLMModel("not-a-real-model")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --filter smoltalk-webllm test`
Expected: FAIL — `models` not exported.

- [ ] **Step 3: Implement `lib/models.ts`**

```typescript
export type WebLLMModelEntry = {
  provider: "webllm";
  contextWindow: number;
  maxOutputTokens: number;
  inputCostPerMillionTokens: number;
  outputCostPerMillionTokens: number;
};

export const models = {
  "Llama-3.2-1B-Instruct-q4f32_1-MLC": {
    provider: "webllm",
    contextWindow: 4096,
    maxOutputTokens: 4096,
    inputCostPerMillionTokens: 0,
    outputCostPerMillionTokens: 0,
  },
  "Llama-3.2-3B-Instruct-q4f32_1-MLC": {
    provider: "webllm",
    contextWindow: 4096,
    maxOutputTokens: 4096,
    inputCostPerMillionTokens: 0,
    outputCostPerMillionTokens: 0,
  },
  "Phi-3.5-mini-instruct-q4f32_1-MLC": {
    provider: "webllm",
    contextWindow: 4096,
    maxOutputTokens: 4096,
    inputCostPerMillionTokens: 0,
    outputCostPerMillionTokens: 0,
  },
  "Qwen2.5-3B-Instruct-q4f32_1-MLC": {
    provider: "webllm",
    contextWindow: 4096,
    maxOutputTokens: 4096,
    inputCostPerMillionTokens: 0,
    outputCostPerMillionTokens: 0,
  },
  "gemma-2-2b-it-q4f32_1-MLC": {
    provider: "webllm",
    contextWindow: 8192,
    maxOutputTokens: 4096,
    inputCostPerMillionTokens: 0,
    outputCostPerMillionTokens: 0,
  },
} as const satisfies Record<string, WebLLMModelEntry>;

export type WebLLMModelId = keyof typeof models;

export function isWebLLMModel(id: string): id is WebLLMModelId {
  return id in models;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter smoltalk-webllm test`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/smoltalk-webllm/lib/models.ts packages/smoltalk-webllm/lib/models.test.ts
git commit -m "add curated webllm model registry"
```

---

## Task 4: Engine module — registry + getEngine

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

export function __engineRegistry() {
  return engines;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter smoltalk-webllm test`
Expected: PASS (3 new tests, plus models tests still pass).

- [ ] **Step 5: Commit**

```bash
git add packages/smoltalk-webllm/lib/engine.ts packages/smoltalk-webllm/lib/engine.test.ts
git commit -m "add webllm engine registry"
```

---

## Task 5: Engine module — loadModel and unloadModel

**Files:**
- Modify: `packages/smoltalk-webllm/lib/engine.ts`
- Modify: `packages/smoltalk-webllm/lib/engine.test.ts`

This task adds the actual `loadModel` function. We don't want tests that download real models, so we'll inject a factory that the test can stub.

- [ ] **Step 1: Add failing tests to `engine.test.ts`**

Append these tests inside the existing `describe("engine registry", ...)` block:

```typescript
import {
  loadModel,
  unloadModel,
  __setEngineFactoryForTesting,
} from "./engine.js";

describe("loadModel", () => {
  beforeEach(() => __clearEnginesForTesting());

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
    await loadModel("a", {
      onProgress: (p) => progressSeen.push(p),
    });
    expect(progressSeen).toHaveLength(1);
    expect(progressSeen[0].stage).toBe("downloading");
    expect(progressSeen[0].loaded).toBe(50);
  });
});

describe("unloadModel", () => {
  beforeEach(() => __clearEnginesForTesting());

  it("calls engine.unload() and removes it from the registry", async () => {
    let unloaded = false;
    __setEngineFactoryForTesting(async () => ({
      unload: async () => {
        unloaded = true;
      },
    }) as any);
    await loadModel("a");
    await unloadModel("a");
    expect(unloaded).toBe(true);
    expect(isLoaded("a")).toBe(false);
  });

  it("is a no-op when the model is not loaded", async () => {
    await expect(unloadModel("nope")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm --filter smoltalk-webllm test`
Expected: FAIL — `loadModel`, `__setEngineFactoryForTesting` not exported.

- [ ] **Step 3: Extend `lib/engine.ts` with loadModel and the factory injection point**

Append to the existing file (do not remove what's there):

```typescript
import type { CustomModel, LoadOptions, LoadProgress, LoadInput } from "./types.js";
import { CreateMLCEngine, type InitProgressReport } from "@mlc-ai/web-llm";

type EngineFactory = (
  id: string,
  opts: LoadOptions | undefined,
  custom: CustomModel | undefined,
) => Promise<MLCEngine>;

const defaultFactory: EngineFactory = async (id, opts, custom) => {
  const initProgressCallback = (r: InitProgressReport) => {
    opts?.onProgress?.(normalizeProgress(r));
  };
  if (custom) {
    return CreateMLCEngine(id, {
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
    });
  }
  return CreateMLCEngine(id, { initProgressCallback });
};

let factory: EngineFactory = defaultFactory;
const loading = new Map<string, Promise<MLCEngine>>();

export async function loadModel(
  input: LoadInput,
  opts?: LoadOptions,
): Promise<void> {
  const id = typeof input === "string" ? input : input.id;
  const custom = typeof input === "string" ? undefined : input;

  if (engines.has(id)) return;
  if (loading.has(id)) {
    await loading.get(id);
    return;
  }

  const promise = factory(id, opts, custom);
  loading.set(id, promise);
  try {
    const engine = await promise;
    engines.set(id, engine);
  } finally {
    loading.delete(id);
  }
}

function normalizeProgress(r: InitProgressReport): LoadProgress {
  // web-llm reports `progress` (0..1) and a `text` description.
  // We map its text to our stage taxonomy with a simple heuristic.
  const text = r.text ?? "";
  const stage: LoadProgress["stage"] =
    r.progress >= 1
      ? "ready"
      : /compil/i.test(text) || /load.*model/i.test(text)
        ? "compiling"
        : "downloading";
  return {
    stage,
    loaded: Math.round((r.progress ?? 0) * 100),
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
git commit -m "add loadModel/unloadModel with factory injection for tests"
```

---

## Task 6: WebLLMClient — _textSync (no tools, no structured output)

**Files:**
- Create: `packages/smoltalk-webllm/lib/client.ts`
- Create: `packages/smoltalk-webllm/lib/client.test.ts`

Start with the simplest case: a plain text completion. Tools and structured output come in later tasks.

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

describe("WebLLMClient._textSync — plain text", () => {
  beforeEach(() => __clearEnginesForTesting());

  it("returns the assistant text from the engine", async () => {
    __setEngineForTesting("m", fakeEngine({ content: "hello world" }));
    const client = new WebLLMClient({
      provider: "webllm",
      model: "m",
      messages: [userMessage("Say hi")],
    });
    const result = await client._textSync(client["config"]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.output).toBe("hello world");
      expect(result.value.model).toBe("m");
    }
  });

  it("populates token usage from engine response", async () => {
    __setEngineForTesting(
      "m",
      fakeEngine({ usage: { prompt_tokens: 11, completion_tokens: 7 } }),
    );
    const client = new WebLLMClient({
      provider: "webllm",
      model: "m",
      messages: [userMessage("Say hi")],
    });
    const result = await client._textSync(client["config"]);
    if (result.success) {
      expect(result.value.usage?.inputTokens).toBe(11);
      expect(result.value.usage?.outputTokens).toBe(7);
      expect(result.value.cost?.inputCost).toBe(0);
      expect(result.value.cost?.outputCost).toBe(0);
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
    await client._textSync(client["config"]);
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
  promptResult,
  success,
} from "smoltalk";
import { getEngine } from "./engine.js";

export class WebLLMClient extends BaseClient {
  async _textSync(promptConfig: SmolConfig): Promise<Result<PromptResult>> {
    const engine = getEngine(promptConfig.model);
    const messages = promptConfig.messages.map((m) => m.toOpenAIMessage());

    const response = await engine.chat.completions.create({
      messages: messages as any,
      temperature: promptConfig.temperature,
      max_tokens: promptConfig.maxTokens,
    } as any);

    const choice = (response as any).choices?.[0];
    const content: string | null = choice?.message?.content ?? null;
    const usage = (response as any).usage;

    return success(
      promptResult({
        output: content,
        toolCalls: [],
        model: promptConfig.model,
        usage: usage
          ? {
              inputTokens: usage.prompt_tokens ?? 0,
              outputTokens: usage.completion_tokens ?? 0,
            }
          : undefined,
        cost: { inputCost: 0, outputCost: 0, totalCost: 0 },
      }),
    );
  }

  async *_textStream(_promptConfig: SmolConfig): AsyncGenerator<StreamChunk> {
    throw new Error("Not yet implemented — see Task 7");
  }
}
```

- [ ] **Step 4: If the `TokenUsage`/`CostEstimate` field names above don't match smoltalk core's types**

Quick check: open `packages/smoltalk/lib/types.ts` and search for `type TokenUsage` and `type CostEstimate`. Adjust the field names in `_textSync` above to match (e.g., if it's `inputTokens` vs `input_tokens`). Re-run the test until it passes.

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
describe("WebLLMClient._textStream", () => {
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
    for await (const c of client._textStream(client["config"])) {
      chunks.push(c);
    }
    const text = chunks.filter((c) => c.type === "text").map((c) => c.text);
    expect(text.join("")).toBe("Hello");
    const last = chunks[chunks.length - 1];
    expect(last.type).toBe("done");
    expect(last.result.output).toBe("Hello");
    expect(last.result.usage?.inputTokens).toBe(2);
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

    const stream = await engine.chat.completions.create({
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
      result: promptResult({
        output: outputText || null,
        toolCalls: [],
        model: promptConfig.model,
        usage: usage
          ? {
              inputTokens: usage.prompt_tokens ?? 0,
              outputTokens: usage.completion_tokens ?? 0,
            }
          : undefined,
        cost: { inputCost: 0, outputCost: 0, totalCost: 0 },
      }),
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

WebLLM's API is OpenAI-shaped, so tool conversion uses the same conversion smoltalk core already has. Check `packages/smoltalk/lib/util/tool.ts` for `toolToOpenAI` (or equivalent name) and re-use it.

- [ ] **Step 1: Inspect the existing tool converter**

Run: `grep -n "export" packages/smoltalk/lib/util/tool.ts | head -20`
Note the exported function names (e.g., `toolToOpenAi`, `toolToOpenAITool`). Use the actual name in the code below.

- [ ] **Step 2: Write failing tests**

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

    const client = new WebLLMClient({
      provider: "webllm",
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
    });
    const result = await client._textSync(client["config"]);
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
    const client = new WebLLMClient({
      provider: "webllm",
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
    });
    await client._textSync(client["config"]);
    expect(received.tools).toBeDefined();
    expect(received.tools[0].function.name).toBe("t");
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

Run: `pnpm --filter smoltalk-webllm test`
Expected: FAIL.

- [ ] **Step 4: Update `_textSync` in `lib/client.ts` to handle tools**

Replace `_textSync` with:

```typescript
import { ToolCall } from "smoltalk";
import { toolToOpenAi } from "smoltalk"; // adjust name to match step 1

// inside class:
  async _textSync(promptConfig: SmolConfig): Promise<Result<PromptResult>> {
    const engine = getEngine(promptConfig.model);
    const messages = promptConfig.messages.map((m) => m.toOpenAIMessage());

    const tools = promptConfig.tools?.length
      ? promptConfig.tools.map((t) => toolToOpenAi(t))
      : undefined;

    const response = await engine.chat.completions.create({
      messages: messages as any,
      tools: tools as any,
      temperature: promptConfig.temperature,
      max_tokens: promptConfig.maxTokens,
    } as any);

    const choice = (response as any).choices?.[0];
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
    const usage = (response as any).usage;

    return success(
      promptResult({
        output: content,
        toolCalls,
        model: promptConfig.model,
        usage: usage
          ? {
              inputTokens: usage.prompt_tokens ?? 0,
              outputTokens: usage.completion_tokens ?? 0,
            }
          : undefined,
        cost: { inputCost: 0, outputCost: 0, totalCost: 0 },
      }),
    );
  }
```

Also update `_textStream` to forward tools and yield `tool_call` chunks:

```typescript
  async *_textStream(promptConfig: SmolConfig): AsyncGenerator<StreamChunk> {
    const engine = getEngine(promptConfig.model);
    const messages = promptConfig.messages.map((m) => m.toOpenAIMessage());
    const tools = promptConfig.tools?.length
      ? promptConfig.tools.map((t) => toolToOpenAi(t))
      : undefined;

    const stream = await engine.chat.completions.create({
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
      result: promptResult({
        output: outputText || null,
        toolCalls,
        model: promptConfig.model,
        usage: usage
          ? {
              inputTokens: usage.prompt_tokens ?? 0,
              outputTokens: usage.completion_tokens ?? 0,
            }
          : undefined,
        cost: { inputCost: 0, outputCost: 0, totalCost: 0 },
      }),
    };
  }
```

- [ ] **Step 5: Run all tests**

Run: `pnpm --filter smoltalk-webllm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/smoltalk-webllm/lib/client.ts packages/smoltalk-webllm/lib/client.test.ts
git commit -m "add tool call support to WebLLMClient"
```

---

## Task 9: WebLLMClient — structured output (JSON / Zod)

**Files:**
- Modify: `packages/smoltalk-webllm/lib/client.ts`
- Modify: `packages/smoltalk-webllm/lib/client.test.ts`

WebLLM accepts an OpenAI-shaped `response_format`. For Zod schemas, convert via `zod-to-json-schema` (already a transitive dep through smoltalk core) or use a helper in smoltalk core if one exists. Verify with `grep -n "zodToJsonSchema\|responseFormat" packages/smoltalk/lib/clients/openai.ts | head`.

- [ ] **Step 1: Confirm core's approach**

Run: `grep -rn "response_format" packages/smoltalk/lib/clients/openai.ts`
Note the exact shape used (likely `{ type: "json_schema", json_schema: { ... } }` or `{ type: "json_object" }`). Mirror it.

- [ ] **Step 2: Write failing test**

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

    const client = new WebLLMClient({
      provider: "webllm",
      model: "m",
      messages: [userMessage("hi")],
      responseFormat: z.object({ x: z.string() }),
    });
    await client._textSync(client["config"]);
    expect(received.response_format).toBeDefined();
  });
});
```

- [ ] **Step 3: Run test to confirm it fails**

Run: `pnpm --filter smoltalk-webllm test`
Expected: FAIL — `response_format` undefined on `received`.

- [ ] **Step 4: Update `_textSync` and `_textStream` to forward response_format**

At the top of `client.ts`:

```typescript
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

function buildResponseFormat(schema: z.ZodType | undefined): any | undefined {
  if (!schema) return undefined;
  return {
    type: "json_schema",
    json_schema: {
      name: "response",
      schema: zodToJsonSchema(schema, { target: "openApi3" }),
      strict: true,
    },
  };
}
```

In both `_textSync` and `_textStream`, add to the `create()` args:

```typescript
      response_format: buildResponseFormat(promptConfig.responseFormat),
```

Add `zod-to-json-schema` to dependencies if it isn't already pulled in transitively:

```bash
pnpm --filter smoltalk-webllm add zod-to-json-schema
```

- [ ] **Step 5: Run tests to confirm they pass**

Run: `pnpm --filter smoltalk-webllm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/smoltalk-webllm
git commit -m "forward responseFormat as response_format to WebLLM engine"
```

---

## Task 10: register() and public exports

**Files:**
- Create: `packages/smoltalk-webllm/lib/register.ts`
- Create: `packages/smoltalk-webllm/lib/register.test.ts`
- Modify: `packages/smoltalk-webllm/lib/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/register.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { register } from "./register.js";
import { unregisterProvider } from "smoltalk";

describe("register()", () => {
  afterEach(() => {
    unregisterProvider("webllm");
  });

  it("is idempotent — calling twice does not throw", () => {
    expect(() => {
      register();
      register();
    }).not.toThrow();
  });

  it("registers the 'webllm' provider with smoltalk core", () => {
    register();
    // unregisterProvider returns true if the provider was registered
    expect(unregisterProvider("webllm")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `pnpm --filter smoltalk-webllm test`
Expected: FAIL.

- [ ] **Step 3: Implement `lib/register.ts`**

```typescript
import { registerProvider } from "smoltalk";
import { WebLLMClient } from "./client.js";

let registered = false;
export function register(): void {
  if (registered) return;
  registerProvider("webllm", WebLLMClient as any);
  registered = true;
}
```

- [ ] **Step 4: Update `lib/index.ts` to export the public surface**

```typescript
export { WebLLMClient } from "./client.js";
export { loadModel, unloadModel, isLoaded } from "./engine.js";
export { register } from "./register.js";
export { models, isWebLLMModel } from "./models.js";
export type { WebLLMModelEntry, WebLLMModelId } from "./models.js";
export type { LoadOptions, LoadProgress, CustomModel, LoadInput } from "./types.js";
```

- [ ] **Step 5: Run tests to confirm they pass**

Run: `pnpm --filter smoltalk-webllm test`
Expected: PASS.

- [ ] **Step 6: Typecheck and build**

Run: `pnpm --filter smoltalk-webllm typecheck && pnpm --filter smoltalk-webllm build`
Expected: both succeed; `dist/` populated.

- [ ] **Step 7: Commit**

```bash
git add packages/smoltalk-webllm
git commit -m "add register() and public exports for smoltalk-webllm"
```

---

## Task 11: WebGPU availability check and AbortSignal in loadModel

**Files:**
- Modify: `packages/smoltalk-webllm/lib/engine.ts`
- Modify: `packages/smoltalk-webllm/lib/engine.test.ts`

The spec calls for an early `SmolError` when WebGPU is unavailable, and for `LoadOptions.signal` to cancel an in-flight load.

- [ ] **Step 1: Write failing tests**

Append to `engine.test.ts`:

```typescript
import { SmolError } from "smoltalk";

describe("loadModel — WebGPU and abort", () => {
  beforeEach(() => __clearEnginesForTesting());

  it("throws SmolError when WebGPU is not available", async () => {
    const original = (globalThis as any).navigator;
    (globalThis as any).navigator = {}; // no .gpu
    try {
      await expect(
        loadModel("Llama-3.2-1B-Instruct-q4f32_1-MLC"),
      ).rejects.toThrow(/WebGPU is not available/);
    } finally {
      (globalThis as any).navigator = original;
    }
  });

  it("rejects with abort error when signal fires", async () => {
    (globalThis as any).navigator = { gpu: {} };
    __setEngineFactoryForTesting(
      () =>
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error("should be aborted first")), 100);
        }),
    );
    const ctrl = new AbortController();
    const p = loadModel("a", { signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toThrow(/aborted/i);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `pnpm --filter smoltalk-webllm test`
Expected: FAIL.

- [ ] **Step 3: Update `loadModel` in `lib/engine.ts`**

At the top of `loadModel`, before any factory call:

```typescript
  if (!(globalThis as any).navigator?.gpu) {
    throw new SmolError(
      "WebGPU is not available in this browser. " +
        "smoltalk-webllm requires a browser with WebGPU support. " +
        "Consider using smoltalk-wllama for universal WebAssembly support.",
    );
  }
```

Wrap the `factory(...)` call so that `opts?.signal` triggers a rejection. Replace the body that does the load with:

```typescript
  const factoryPromise = factory(id, opts, custom);
  const promise = opts?.signal
    ? Promise.race([
        factoryPromise,
        new Promise<MLCEngine>((_resolve, reject) => {
          if (opts.signal!.aborted) {
            reject(new SmolError("Model load aborted"));
            return;
          }
          opts.signal!.addEventListener(
            "abort",
            () => reject(new SmolError("Model load aborted")),
            { once: true },
          );
        }),
      ])
    : factoryPromise;
```

- [ ] **Step 4: Run all tests**

Run: `pnpm --filter smoltalk-webllm test`
Expected: PASS.

Note: existing tests that call `loadModel` without setting `navigator.gpu` will need a `beforeEach` that sets `(globalThis as any).navigator = { gpu: {} };` — add this to the `describe("loadModel", ...)` and `describe("unloadModel", ...)` blocks if they now fail.

- [ ] **Step 5: Commit**

```bash
git add packages/smoltalk-webllm
git commit -m "add WebGPU availability check and AbortSignal support"
```

---

## Task 12: Wire smoltalk-webllm into the root Makefile

**Files:**
- Modify: `Makefile` (repo root)

- [ ] **Step 1: Inspect the current root Makefile**

Run: `cat Makefile`
Note the pattern for recursing into packages.

- [ ] **Step 2: Add `smoltalk-webllm` to each loop/list of packages**

Edit the root `Makefile` to include `packages/smoltalk-webllm` in the same iteration that already handles `packages/smoltalk` and `packages/smoltalk-llama-cpp` for the `all`, `test`, and `publish` targets. The exact edit depends on the existing form (if it's `for d in packages/smoltalk packages/smoltalk-llama-cpp; do ...`, append `packages/smoltalk-webllm`).

- [ ] **Step 3: Verify**

Run: `make test`
Expected: tests for smoltalk, smoltalk-llama-cpp, and smoltalk-webllm all run.

- [ ] **Step 4: Commit**

```bash
git add Makefile
git commit -m "include smoltalk-webllm in root make targets"
```

---

## Task 13: Self-review and final verification

- [ ] **Step 1: Run all tests, typecheck, and build across the workspace**

```bash
pnpm typecheck
pnpm test
pnpm build
```

Expected: all succeed.

- [ ] **Step 2: Verify the public API surface**

Open `packages/smoltalk-webllm/dist/index.d.ts`. Confirm it exports:
- `WebLLMClient`
- `loadModel`, `unloadModel`, `isLoaded`
- `register`
- `models`, `isWebLLMModel`
- types: `LoadOptions`, `LoadProgress`, `CustomModel`, `LoadInput`, `WebLLMModelEntry`, `WebLLMModelId`

- [ ] **Step 3: Spot-check the README example compiles**

Manually walk through the README usage example against the actual exports. Fix wording if anything is off.

- [ ] **Step 4: Final commit if anything was tweaked**

```bash
git status
# only commit if there are changes
git add -A && git commit -m "polish smoltalk-webllm public API"
```

---

## Notes for the implementer

- **`as any` casts on engine arguments:** WebLLM's TypeScript types are sometimes stricter than the runtime accepts (e.g., custom `appConfig` shapes). The `as any` casts in the create() calls are intentional to keep this plan moving; tighten them later if it bothers you.
- **TokenUsage / CostEstimate field names:** Verify against `packages/smoltalk/lib/types.ts` before assuming. The plan uses `inputTokens` / `outputTokens` / `inputCost` / `outputCost`; if the core types use snake_case or different names, adjust everywhere they appear.
- **Tool conversion function name:** Likely `toolToOpenAi`, but confirm in `packages/smoltalk/lib/util/tool.ts`. Task 8 says so explicitly.
- **No integration tests:** This plan covers only unit tests with mocked engines. A real end-to-end smoke test against an actual WebLLM model is deferred to a follow-up (it requires multi-GB downloads and a real browser).
- **Follow-up plan:** `smoltalk-wllama` is a separate plan that will follow this one. The wllama work is meaningfully different (no native tool calls, GBNF grammars for structured output, GGUF loading from URLs) and deserves its own plan.
