# Browser LLM Packages: smoltalk-webllm and smoltalk-wllama

**Date:** 2026-05-13
**Status:** Design

## Overview

Add two new workspace packages that let smoltalk users run LLMs directly in the browser:

- **`smoltalk-webllm`** — wraps [`@mlc-ai/web-llm`](https://github.com/mlc-ai/web-llm). WebGPU-accelerated, OpenAI-compatible API, best performance.
- **`smoltalk-wllama`** — wraps [`@wllama/wllama`](https://github.com/ngxson/wllama). WebAssembly + SIMD, loads GGUF directly, universal browser support.

Each is a standalone plugin that registers with smoltalk core, mirroring the existing `smoltalk-llama-cpp` pattern (one runtime per package, peer-dependency on `smoltalk`).

## Motivation

Today users have two execution modes: cloud (smoltalk core) or local-on-server (smoltalk-llama-cpp via Node + llama.cpp). The missing mode is **local-in-browser**, which unlocks zero-server applications, full privacy, and offline-capable web apps. Two packages instead of one because the two runtimes have different tradeoffs:

- WebLLM: highest performance, requires WebGPU (~83% browser coverage), MLC-compiled model format
- wllama: universal compatibility, slower (CPU-only), uses standard GGUF files (parity with smoltalk-llama-cpp)

They are complementary; users can pick what fits their audience.

## Non-goals

- Server-side rendering: these packages are browser-only (`"browser"` field set).
- Bundler-less / `<script src>` usage: assumes a modern bundler (Vite, webpack, Next.js).
- Single combined package: kept separate to preserve tree-shaking and the existing "one provider per package" pattern.
- Framework wrappers (React hooks, Vue composables): out of scope for v0.1.
- A "browser Prompt API" provider (Chrome's `LanguageModel`): may be added later as a third package, not in this design.

## Package Layout

```
packages/
├── smoltalk/                  # existing
├── smoltalk-llama-cpp/        # existing
├── smoltalk-webllm/           # NEW
│   ├── lib/
│   │   ├── index.ts           # public exports
│   │   ├── client.ts          # WebLLMClient extends BaseClient
│   │   ├── engine.ts          # loadModel / getEngine / unloadModel
│   │   ├── models.ts          # curated model registry
│   │   └── register.ts        # registerProvider("webllm", WebLLMClient)
│   ├── package.json
│   ├── tsconfig.json
│   └── README.md
└── smoltalk-wllama/           # NEW
    ├── lib/
    │   ├── index.ts
    │   ├── client.ts          # WllamaClient extends BaseClient
    │   ├── engine.ts          # loadModel / getEngine / unloadModel
    │   ├── models.ts
    │   ├── grammar.ts         # Zod → GBNF for structured output
    │   ├── tools.ts           # prompt-based tool calling
    │   └── register.ts
    ├── package.json
    ├── tsconfig.json
    └── README.md
```

Each `package.json`:
- `"type": "module"`
- `"sideEffects": false`
- `"browser"` field set, no `"main"` for Node
- `peerDependencies: { "smoltalk": "^0.2.0" }`
- `dependencies` contains only the runtime (`@mlc-ai/web-llm` or `@wllama/wllama`)
- Single `"."` export

## Public API

Both packages expose the same five-symbol surface:

```typescript
// smoltalk-webllm OR smoltalk-wllama
export { register } from "./register.js";
export { loadModel, unloadModel, isLoaded } from "./engine.js";
export { models } from "./models.js";
export { WebLLMClient /* or WllamaClient */ } from "./client.js";
export type { LoadOptions, LoadProgress, CustomModel } from "./types.js";
```

### Typical usage

```typescript
import { text } from "smoltalk";
import { register, loadModel } from "smoltalk-webllm";

register(); // idempotent; registers provider "webllm" with smoltalk core

await loadModel("Llama-3.2-3B-Instruct-q4f32_1-MLC", {
  onProgress: (p) => console.log(`${p.stage}: ${p.loaded}/${p.total}`),
});

const result = await text("Hello", {
  model: "Llama-3.2-3B-Instruct-q4f32_1-MLC",
});
```

### Load options

```typescript
type LoadOptions = {
  onProgress?: (p: LoadProgress) => void;
  signal?: AbortSignal;
};

type LoadProgress = {
  stage: "downloading" | "compiling" | "ready"; // wllama: "downloading" | "initializing" | "ready"
  loaded: number;   // bytes
  total: number;    // bytes (0 if unknown)
  text?: string;    // optional human-readable status from runtime
};
```

### Custom models (escape hatch)

```typescript
// smoltalk-webllm
await loadModel({
  id: "my-custom-llama",
  modelUrl: "https://...",     // MLC model artifact URL
  modelLibUrl: "https://...",  // compiled WASM lib URL
  contextWindow: 8192,
});

// smoltalk-wllama
await loadModel({
  id: "my-custom-gguf",
  url: "https://huggingface.co/.../model.Q4_K_M.gguf",
  // or url: ["shard-001.gguf", "shard-002.gguf"] for split files
  contextWindow: 4096,
});
```

`loadModel`'s first parameter is `string | CustomModel`. String form looks up the curated registry; object form is used directly.

## Architecture

### Engine module (per package)

Browser runtimes are stateful: a model is downloaded once and lives in memory. The package keeps a module-level `Map<modelId, Engine>` and exposes `loadModel`, `getEngine`, `unloadModel`, `isLoaded`.

```typescript
// smoltalk-webllm/lib/engine.ts
const engines = new Map<string, MLCEngine>();
const loading = new Map<string, Promise<MLCEngine>>(); // dedupe concurrent loads

export async function loadModel(idOrCustom, opts?) {
  const id = typeof idOrCustom === "string" ? idOrCustom : idOrCustom.id;
  if (engines.has(id)) return;
  if (loading.has(id)) return loading.get(id);

  const promise = CreateMLCEngine(id, {
    initProgressCallback: (r) => opts?.onProgress?.(normalizeProgress(r)),
    appConfig: typeof idOrCustom === "object" ? buildAppConfig(idOrCustom) : undefined,
  });
  loading.set(id, promise);
  try {
    engines.set(id, await promise);
  } finally {
    loading.delete(id);
  }
}

export function getEngine(id: string): MLCEngine {
  const e = engines.get(id);
  if (!e) throw new SmolError(`Model not loaded: call loadModel("${id}") first`);
  return e;
}

export async function unloadModel(id: string) {
  const e = engines.get(id);
  if (e) await e.unload();
  engines.delete(id);
}

export function isLoaded(id: string): boolean {
  return engines.has(id);
}
```

`smoltalk-wllama` has the analogous file using the `Wllama` class.

### Client class (per package)

Each client extends `BaseClient` and overrides `_textSync()` and `_textStream()`. `BaseClient` already handles retries, tool-loop detection, and response-format validation, so the client only handles provider-specific format conversion and the actual inference call.

```typescript
// smoltalk-webllm/lib/client.ts
export class WebLLMClient extends BaseClient {
  protected async _textSync(messages, config) {
    const engine = getEngine(config.model);
    const oaiMessages = messages.map(m => m.toOpenAIMessage());
    const response = await engine.chat.completions.create({
      messages: oaiMessages,
      tools: config.tools ? config.tools.map(toolToOpenAI) : undefined,
      response_format: config.responseFormat ? toOAIResponseFormat(config.responseFormat) : undefined,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
    });
    return buildPromptResult(response, config);
  }

  protected async *_textStream(messages, config) {
    const engine = getEngine(config.model);
    const stream = await engine.chat.completions.create({
      messages: messages.map(m => m.toOpenAIMessage()),
      stream: true,
      // ...same options
    });
    for await (const chunk of stream) {
      // emit StreamChunk events: text, tool_call, done
    }
  }
}
```

### Register module

```typescript
// smoltalk-webllm/lib/register.ts
import { registerProvider } from "smoltalk";
import { WebLLMClient } from "./client.js";

let registered = false;
export function register() {
  if (registered) return;
  registerProvider("webllm", WebLLMClient);
  registered = true;
}
```

Same for wllama with provider name `"wllama"`.

### Model registry

Each package ships `lib/models.ts` with a small curated list. Entries match the shape used by smoltalk core's `lib/models.ts` (`contextWindow`, `maxOutputTokens`, etc.) plus runtime-specific fields:

```typescript
// smoltalk-webllm/lib/models.ts
export const models = {
  "Llama-3.2-3B-Instruct-q4f32_1-MLC": {
    provider: "webllm",
    contextWindow: 4096,
    maxOutputTokens: 4096,
    inputCostPerMillionTokens: 0,
    outputCostPerMillionTokens: 0,
    // WebLLM resolves these from its prebuilt config automatically
  },
  // ~6 hand-picked models covering small/medium sizes
} as const;
```

```typescript
// smoltalk-wllama/lib/models.ts
export const models = {
  "llama-3.2-3b-instruct-q4_k_m": {
    provider: "wllama",
    contextWindow: 4096,
    maxOutputTokens: 4096,
    url: "https://huggingface.co/.../llama-3.2-3b-instruct-q4_k_m.gguf",
    inputCostPerMillionTokens: 0,
    outputCostPerMillionTokens: 0,
  },
  // ~6 hand-picked GGUFs
} as const;
```

Curated IDs are typed; custom models bypass the registry via the `CustomModel` object form.

## Feature Support

### Text + streaming
Both packages. WebLLM has a native streaming API; wllama exposes a token-by-token callback that we adapt into an AsyncGenerator.

### Tool calling
- **WebLLM:** Native OpenAI-compatible `tools` and `tool_choice` parameters. Conversion uses the existing `toolToOpenAI` from smoltalk core (`lib/util/tool.ts`).
- **wllama:** No native tool calling. Implement prompt-based tool calling in `lib/tools.ts`: inject tool schemas into the system prompt with an instruction to emit `<tool_call>{...}</tool_call>` blocks, then parse the stream for these blocks and emit `tool_call` StreamChunks. Document this as best-effort and model-dependent.

### Structured output
- **WebLLM:** Native JSON mode + grammar-based structured generation. Zod schemas convert to JSON Schema via the existing helper in smoltalk core; pass as `response_format: { type: "json_object", schema }`.
- **wllama:** llama.cpp supports GBNF grammars. Implement `lib/grammar.ts` to convert Zod schemas → JSON Schema → GBNF. (There's a published `json-schema-to-gbnf` reference we can adapt; we'll write our own to avoid an extra dep.)

### Thinking blocks
Not supported in v0.1. Neither runtime exposes a thinking-block concept. Field remains `[]` in `PromptResult`.

### Cost tracking
Both packages populate `usage.inputTokens` and `usage.outputTokens` from the runtime's reported counts. `usage.inputCost` and `usage.outputCost` are always `0` (local inference). Models in the registry have cost fields set to `0`.

## Error Handling

All errors thrown by the packages are `SmolError` instances from smoltalk core, so callers can catch a single error type regardless of provider.

- **Model not loaded:** `SmolError("Model not loaded: call loadModel(\"<id>\") first")` from `getEngine()`.
- **WebGPU not available** (smoltalk-webllm only): `loadModel` throws `SmolError("WebGPU is not available in this browser")` early, with a hint to fall back to smoltalk-wllama.
- **Download/network failures:** Bubble up as `SmolError` with the underlying cause attached.
- **Abort:** `LoadOptions.signal` cancels in-flight downloads; throws `SmolError("Model load aborted")`.
- **Unsupported feature:** If a user requests tools on wllama with a model the prompt-based path doesn't handle reliably, log a warning but attempt anyway (don't hard-fail — the user opted in).

`BaseClient`'s existing retry logic for response-format failures applies to both packages; inference-time errors propagate.

## Testing

Each package gets:

- **Unit tests (vitest, jsdom env where needed):**
  - Engine registry: load dedupes concurrent calls, unload frees, getEngine throws before load.
  - Model registry: curated IDs resolve, custom model object passes through.
  - Format conversion: messages/tools/response_format round-trip correctly (no runtime needed — mock the engine).
  - Stream chunk emission: simulate engine output, assert StreamChunk sequence.
  - wllama-specific: Zod → GBNF conversion correctness on a small set of schemas.
  - wllama-specific: tool-call parser correctly extracts `<tool_call>` blocks from a token stream.
- **Integration tests:** Skipped by default in CI (they require GBs of model download). Provide an `pnpm test:integration` script that loads a tiny model (e.g., TinyLlama Q4 for wllama; smallest MLC model for webllm) and runs one round-trip.
- **Manual smoke test:** `examples/browser-demo/` — a tiny Vite app importing one of the packages and rendering a chat UI. Used to verify the package works end-to-end before publishing.

## Build & Publishing

- Each package has its own `Makefile` mirroring `smoltalk-llama-cpp`: `build`, `test`, `typecheck`, `publish`.
- Root `Makefile` recurses into both new packages.
- Versioning: independent. Start both at `0.1.0`.
- License: ISC (matches the rest of the repo).

## Open Questions

None blocking. To revisit after v0.1 ships:

- Whether to surface IndexedDB cache controls (WebLLM caches model weights automatically; wllama uses OPFS). Users may want a `clearCache()` API eventually.
- Whether a future `smoltalk-prompt-api` package for Chrome's built-in Gemini Nano is worth the maintenance.
- Whether to extract any shared code into a `smoltalk-browser-shared` package — defer until the duplication is concrete.
