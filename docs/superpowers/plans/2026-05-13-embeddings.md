# Embeddings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `embed()` function to smoltalk for computing embeddings across OpenAI, Google, and Ollama providers.

**Architecture:** Function-based (no classes). A top-level `embed()` dispatches to per-provider functions via a switch. Shared provider/key resolution logic is extracted from `getClient()` into reusable utilities. Existing text generation classes are untouched.

**Tech Stack:** TypeScript, vitest, OpenAI SDK, @google/genai SDK, Ollama SDK

**Spec:** `docs/superpowers/specs/2026-05-13-embeddings-design.md`

**Deviations from spec (verified against installed SDKs):**

1. The spec uses `ollamaBaseUrl` in `EmbedConfig`, but existing `SmolConfig` uses `ollamaHost`. This plan uses `ollamaHost` to stay consistent with the codebase.
2. The spec said Google's SDK has `batchEmbedContents`, but the installed `@google/genai` v1.x SDK actually exposes `client.models.embedContent({ model, contents, config: { outputDimensionality } })` where `contents` accepts a `string[]` directly. We use `embedContent`.
3. The spec said Ollama doesn't support a `dimensions` parameter, but the installed `ollama` SDK's `EmbedRequest` does accept `dimensions`. We pass it through.
4. **Google cost tracking**: `EmbedContentResponse` (Gemini API) does NOT return token usage. We cannot populate `tokenUsage` or `costEstimate` for Google without a second `countTokens()` call. We omit cost data and document this. The `tokenCost` entries in the registry remain for reference.
5. **Ollama cost tracking**: `EmbedResponse` returns `prompt_eval_count` (token count). We populate `tokenUsage` for Ollama. Cost is omitted because Ollama models are dynamic/unregistered (per existing pattern).
6. Index exports use `export *` to match the existing convention in `lib/index.ts`.
7. `EmbedConfig.provider?: Provider` uses the loose `Provider` type so users can pass custom provider names (consistent with existing `SmolConfig`).

---

### Task 1: Update Model Registry for Embeddings

Add `provider` field to `EmbeddingsModel` type and embedding model entries, add new models, and include `embeddingsModels` in `getModel()` lookup.

**Files:**
- Modify: `packages/smoltalk/lib/models.ts:56-62` (EmbeddingsModel type)
- Modify: `packages/smoltalk/lib/models.ts:850-852` (embeddingsModels array)
- Modify: `packages/smoltalk/lib/models.ts:870-878` (getModel function)

- [ ] **Step 1: Add `provider` to `EmbeddingsModel` type**

```typescript
export type EmbeddingsModel = {
  type: "embeddings";
  modelName: string;
  provider: string;
  // costs per 1M tokens, in dollars
  tokenCost?: number;
};
```

- [ ] **Step 2: Update `embeddingsModels` array with new models and provider field**

```typescript
export const embeddingsModels = [
  { type: "embeddings", modelName: "text-embedding-3-small", provider: "openai", tokenCost: 0.02 },
  { type: "embeddings", modelName: "text-embedding-3-large", provider: "openai", tokenCost: 0.13 },
  { type: "embeddings", modelName: "gemini-embedding-001", provider: "google", tokenCost: 0.15 },
  { type: "embeddings", modelName: "gemini-embedding-2-preview", provider: "google", tokenCost: 0.20 },
] as const;
```

- [ ] **Step 3: Add `embeddingsModels` to `getModel()` lookup**

In the `getModel` function, add `...embeddingsModels` to the `allModels` array:

```typescript
export function getModel(modelName: ModelName) {
  const allModels = [
    ...textModels,
    ...imageModels,
    ...speechToTextModels,
    ...registeredTextModels,
    ...embeddingsModels,
  ];
  return allModels.find((model) => model.modelName === modelName);
}
```

- [ ] **Step 4: Run typecheck and existing tests**

Run: `cd packages/smoltalk && pnpm typecheck && pnpm test`
Expected: All pass, no regressions.

- [ ] **Step 5: Commit**

```bash
git add packages/smoltalk/lib/models.ts
git commit -m "feat(models): add provider field to embeddings models, add new embedding models"
```

---

### Task 2: Extract Provider Resolution Utilities

Extract `resolveProvider()` and `resolveApiKey()` from `getClient()` in `client.ts` into `lib/util/provider.ts`. Refactor `getClient()` to use them. Run existing tests to verify no regression.

**Files:**
- Create: `packages/smoltalk/lib/util/provider.ts`
- Create: `packages/smoltalk/lib/util/provider.test.ts`
- Modify: `packages/smoltalk/lib/client.ts:34-106`

- [ ] **Step 1: Create `lib/util/provider.ts`**

```typescript
import { getModel, isTextModel, isEmbeddingsModel } from "../models.js";
import { SmolError } from "../smolError.js";

/**
 * Resolve the provider for a given model name.
 * If an explicit provider is given, returns it directly.
 * Otherwise looks up the model in the registry.
 */
export function resolveProvider(
  modelName: string,
  explicitProvider?: string,
): string {
  if (explicitProvider) return explicitProvider;

  const model = getModel(modelName);
  if (model === undefined) {
    throw new SmolError(
      `Model ${modelName} is not recognized. Please specify a known model, or explicitly set the provider option in the config.`,
    );
  }
  return model.provider;
}

type ApiKeyConfig = {
  openAiApiKey?: string;
  googleApiKey?: string;
  anthropicApiKey?: string;
  ollamaApiKey?: string;
};

/**
 * Resolve the API key for a provider, checking config then env vars.
 */
export function resolveApiKey(
  provider: string,
  config: ApiKeyConfig,
): string | undefined {
  switch (provider) {
    case "openai":
    case "openai-responses":
      return config.openAiApiKey || process.env.OPENAI_API_KEY;
    case "google":
      return config.googleApiKey || process.env.GEMINI_API_KEY;
    case "anthropic":
      return config.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
    case "ollama":
      return config.ollamaApiKey;
    default:
      return undefined;
  }
}
```

- [ ] **Step 2: Write tests for the new utilities**

Create `packages/smoltalk/lib/util/provider.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveProvider, resolveApiKey } from "./provider.js";

describe("resolveProvider", () => {
  it("returns explicit provider when given", () => {
    expect(resolveProvider("any-model", "openai")).toBe("openai");
  });

  it("resolves provider from registered text model", () => {
    expect(resolveProvider("gpt-4o")).toBe("openai");
  });

  it("resolves provider from registered embeddings model", () => {
    expect(resolveProvider("text-embedding-3-small")).toBe("openai");
    expect(resolveProvider("gemini-embedding-001")).toBe("google");
  });

  it("throws for unrecognized model without explicit provider", () => {
    expect(() => resolveProvider("nonexistent-model")).toThrow(
      /not recognized/,
    );
  });
});

describe("resolveApiKey", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("prefers config key over env var", () => {
    process.env.OPENAI_API_KEY = "env-key";
    expect(resolveApiKey("openai", { openAiApiKey: "config-key" })).toBe(
      "config-key",
    );
  });

  it("falls back to env var when config key is missing", () => {
    process.env.OPENAI_API_KEY = "env-key";
    expect(resolveApiKey("openai", {})).toBe("env-key");
  });

  it("returns undefined when no key is available", () => {
    expect(resolveApiKey("openai", {})).toBeUndefined();
  });

  it("resolves Google key from GEMINI_API_KEY env var", () => {
    process.env.GEMINI_API_KEY = "gemini-key";
    expect(resolveApiKey("google", {})).toBe("gemini-key");
  });

  it("resolves Anthropic key", () => {
    expect(
      resolveApiKey("anthropic", { anthropicApiKey: "anth-key" }),
    ).toBe("anth-key");
  });

  it("handles openai-responses same as openai", () => {
    expect(
      resolveApiKey("openai-responses", { openAiApiKey: "key" }),
    ).toBe("key");
  });

  it("returns ollamaApiKey for ollama provider", () => {
    expect(resolveApiKey("ollama", { ollamaApiKey: "olla-key" })).toBe(
      "olla-key",
    );
  });

  it("returns undefined for unknown provider", () => {
    expect(resolveApiKey("unknown", {})).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail (provider.ts not yet created)**

Run: `cd packages/smoltalk && npx vitest run lib/util/provider.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Create `lib/util/provider.ts`** (from Step 1 above)

- [ ] **Step 5: Run provider tests to verify they pass**

Run: `cd packages/smoltalk && npx vitest run lib/util/provider.test.ts`
Expected: PASS.

- [ ] **Step 6: Refactor `getClient()` to use the new utilities**

Replace the inline provider resolution and key resolution in `getClient()` with calls to the new functions. Import `resolveProvider` and `resolveApiKey` from `./util/provider.js`.

The refactored `getClient()`:

```typescript
import { resolveProvider, resolveApiKey } from "./util/provider.js";

export function getClient(config: SmolClientConfig) {
  const modelName = config.model;
  const provider = config.provider || resolveProvider(modelName);

  // For getClient, we still need to validate it's a text model when no explicit provider
  if (!config.provider) {
    const model = getModel(modelName);
    if (model && !isTextModel(model)) {
      throw new SmolError(
        `Only text models are supported currently. ${modelName} is a ${model?.type} model.`,
      );
    }
  }

  const resolvedKeys = {
    openAiApiKey: resolveApiKey("openai", config) as string | undefined,
    googleApiKey: resolveApiKey("google", config) as string | undefined,
    anthropicApiKey: resolveApiKey("anthropic", config) as string | undefined,
  };
  const clientConfig: SmolConfig = {
    messages: [],
    ...config,
    ...resolvedKeys,
    model: modelName,
  };
  switch (provider) {
    case "anthropic":
      if (!resolvedKeys.anthropicApiKey) {
        throw new SmolError(
          "No Anthropic API key provided. Please provide an Anthropic API key in the config using anthropicApiKey, or set the ANTHROPIC_API_KEY environment variable.",
        );
      }
      return new SmolAnthropic({
        ...clientConfig,
        anthropicApiKey: resolvedKeys.anthropicApiKey,
      });
    case "openai":
      if (!resolvedKeys.openAiApiKey) {
        throw new SmolError(
          "No OpenAI API key provided. Please provide an OpenAI API key in the config using openAiApiKey, or set the OPENAI_API_KEY environment variable.",
        );
      }
      return new SmolOpenAi(clientConfig);
    case "openai-responses":
      if (!resolvedKeys.openAiApiKey) {
        throw new SmolError(
          "No OpenAI API key provided. Please provide an OpenAI API key in the config using openAiApiKey, or set the OPENAI_API_KEY environment variable.",
        );
      }
      return new SmolOpenAiResponses(clientConfig);
    case "google":
      if (!resolvedKeys.googleApiKey) {
        throw new SmolError(
          "No Google API key provided. Please provide a Google API key in the config using googleApiKey, or set the GEMINI_API_KEY environment variable.",
        );
      }
      return new SmolGoogle(clientConfig);
    case "ollama":
      return new SmolOllama(clientConfig);
    default:
      if (provider in registeredProviders) {
        const ClientClass = registeredProviders[provider];
        return new ClientClass(clientConfig);
      }
      throw new SmolError(
        `Model provider ${provider} is not supported. To use a custom provider, register it first via registerProvider(name, ClientClass).`,
      );
  }
}
```

- [ ] **Step 7: Run typecheck and all existing tests**

Run: `cd packages/smoltalk && pnpm typecheck && pnpm test`
Expected: All pass. This is a pure refactor — no behavior change.

- [ ] **Step 8: Commit**

```bash
git add packages/smoltalk/lib/util/provider.ts packages/smoltalk/lib/util/provider.test.ts packages/smoltalk/lib/client.ts
git commit -m "refactor: extract resolveProvider and resolveApiKey into lib/util/provider.ts"
```

---

### Task 3: Define EmbedConfig and EmbedResult Types

**Files:**
- Create: `packages/smoltalk/lib/embed.ts`

- [ ] **Step 1: Create `lib/embed.ts` with types only (no implementation yet)**

```typescript
import { Provider } from "./models.js";
import { Result } from "./types/result.js";
import { TokenUsage } from "./types/tokenUsage.js";
import { CostEstimate } from "./types/costEstimate.js";

export type EmbedConfig = {
  model: string;
  provider?: Provider;
  dimensions?: number;

  // API keys
  openAiApiKey?: string;
  googleApiKey?: string;
  ollamaApiKey?: string;

  // Ollama-specific
  ollamaHost?: string;

  // Plugin support
  metadata?: Record<string, unknown>;
};

export type EmbedResult = {
  embeddings: number[][];
  model: string;
  tokenUsage?: TokenUsage;
  costEstimate?: CostEstimate;
};
```

- [ ] **Step 2: Run typecheck**

Run: `cd packages/smoltalk && pnpm typecheck`
Expected: Pass.

- [ ] **Step 3: Commit**

```bash
git add packages/smoltalk/lib/embed.ts
git commit -m "feat(embed): add EmbedConfig and EmbedResult types"
```

---

### Task 4: Implement OpenAI Embeddings Provider

**Files:**
- Create: `packages/smoltalk/lib/embed/openai.ts`
- Create: `packages/smoltalk/lib/embed/openai.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect, vi } from "vitest";

// We'll mock the OpenAI SDK
vi.mock("openai", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      embeddings: {
        create: vi.fn().mockResolvedValue({
          data: [
            { embedding: [0.1, 0.2, 0.3], index: 0 },
            { embedding: [0.4, 0.5, 0.6], index: 1 },
          ],
          model: "text-embedding-3-small",
          usage: { prompt_tokens: 10, total_tokens: 10 },
        }),
      },
    })),
  };
});

import { openaiEmbed } from "./openai.js";

describe("openaiEmbed", () => {
  it("returns embeddings for batch input", async () => {
    const result = await openaiEmbed(
      ["hello", "world"],
      { model: "text-embedding-3-small" },
      "test-api-key",
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.embeddings).toHaveLength(2);
      expect(result.value.embeddings[0]).toEqual([0.1, 0.2, 0.3]);
      expect(result.value.embeddings[1]).toEqual([0.4, 0.5, 0.6]);
      expect(result.value.model).toBe("text-embedding-3-small");
      expect(result.value.tokenUsage?.inputTokens).toBe(10);
    }
  });

  it("passes dimensions when specified", async () => {
    const OpenAI = (await import("openai")).default;
    const mockInstance = new OpenAI();

    await openaiEmbed(
      ["hello"],
      { model: "text-embedding-3-small", dimensions: 256 },
      "test-api-key",
    );

    expect(mockInstance.embeddings.create).toHaveBeenCalledWith(
      expect.objectContaining({ dimensions: 256 }),
    );
  });

  it("returns failure on API error", async () => {
    const OpenAI = (await import("openai")).default;
    vi.mocked(OpenAI).mockImplementationOnce(() => ({
      embeddings: {
        create: vi.fn().mockRejectedValue(new Error("rate limit")),
      },
    }) as any);

    const result = await openaiEmbed(
      ["hello"],
      { model: "text-embedding-3-small" },
      "test-api-key",
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("rate limit");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/smoltalk && npx vitest run lib/embed/openai.test.ts`
Expected: FAIL — `openai.ts` doesn't exist yet.

- [ ] **Step 3: Implement `lib/embed/openai.ts`**

```typescript
import OpenAI from "openai";
import { EmbedConfig, EmbedResult } from "../embed.js";
import { Result, success, failure } from "../types/result.js";
import { getModel, isEmbeddingsModel } from "../models.js";
import { round } from "../util/util.js";

export async function openaiEmbed(
  inputs: string[],
  config: EmbedConfig,
  apiKey: string,
): Promise<Result<EmbedResult>> {
  try {
    const client = new OpenAI({ apiKey });
    const response = await client.embeddings.create({
      model: config.model,
      input: inputs,
      ...(config.dimensions !== undefined
        ? { dimensions: config.dimensions }
        : {}),
    });

    const embeddings = response.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);

    const inputTokens = response.usage.prompt_tokens;
    const costEstimate = calculateEmbeddingCost(config.model, inputTokens);

    return success({
      embeddings,
      model: response.model,
      tokenUsage: { inputTokens, outputTokens: 0 },
      costEstimate,
    });
  } catch (err) {
    return failure(
      err instanceof Error ? err.message : "OpenAI embedding request failed",
    );
  }
}

function calculateEmbeddingCost(modelName: string, inputTokens: number) {
  const model = getModel(modelName);
  if (!model || !isEmbeddingsModel(model) || !model.tokenCost) return undefined;

  const inputCost = round((inputTokens * model.tokenCost) / 1_000_000, 6);
  return {
    inputCost,
    outputCost: 0,
    totalCost: inputCost,
    currency: "USD",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/smoltalk && npx vitest run lib/embed/openai.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/smoltalk/lib/embed/openai.ts packages/smoltalk/lib/embed/openai.test.ts
git commit -m "feat(embed): implement OpenAI embeddings provider"
```

---

### Task 5: Implement Google Embeddings Provider

**Files:**
- Create: `packages/smoltalk/lib/embed/google.ts`
- Create: `packages/smoltalk/lib/embed/google.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("@google/genai", () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(() => ({
      models: {
        embedContent: vi.fn().mockResolvedValue({
          embeddings: [
            { values: [0.1, 0.2, 0.3] },
            { values: [0.4, 0.5, 0.6] },
          ],
        }),
      },
    })),
  };
});

import { googleEmbed } from "./google.js";

describe("googleEmbed", () => {
  it("returns embeddings for batch input", async () => {
    const result = await googleEmbed(
      ["hello", "world"],
      { model: "gemini-embedding-001" },
      "test-api-key",
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.embeddings).toHaveLength(2);
      expect(result.value.embeddings[0]).toEqual([0.1, 0.2, 0.3]);
      expect(result.value.embeddings[1]).toEqual([0.4, 0.5, 0.6]);
      expect(result.value.model).toBe("gemini-embedding-001");
    }
  });

  it("passes outputDimensionality when dimensions is specified", async () => {
    const { GoogleGenAI } = await import("@google/genai");
    const mockInstance = new GoogleGenAI({} as any);

    await googleEmbed(
      ["hello"],
      { model: "gemini-embedding-001", dimensions: 256 },
      "test-api-key",
    );

    expect(mockInstance.models.embedContent).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ outputDimensionality: 256 }),
      }),
    );
  });

  it("returns failure on API error", async () => {
    const { GoogleGenAI } = await import("@google/genai");
    vi.mocked(GoogleGenAI).mockImplementationOnce(() => ({
      models: {
        embedContent: vi.fn().mockRejectedValue(new Error("quota exceeded")),
      },
    }) as any);

    const result = await googleEmbed(
      ["hello"],
      { model: "gemini-embedding-001" },
      "test-api-key",
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("quota exceeded");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/smoltalk && npx vitest run lib/embed/google.test.ts`
Expected: FAIL — `google.ts` doesn't exist yet.

- [ ] **Step 3: Implement `lib/embed/google.ts`**

Implementation uses the actual `@google/genai` v1.x API: `client.models.embedContent({ model, contents, config })` where `contents` accepts a `string[]`.

```typescript
import { GoogleGenAI } from "@google/genai";
import { EmbedConfig, EmbedResult } from "../embed.js";
import { Result, success, failure } from "../types/result.js";

export async function googleEmbed(
  inputs: string[],
  config: EmbedConfig,
  apiKey: string,
): Promise<Result<EmbedResult>> {
  try {
    const client = new GoogleGenAI({ apiKey });
    const response = await client.models.embedContent({
      model: config.model,
      contents: inputs,
      ...(config.dimensions !== undefined
        ? { config: { outputDimensionality: config.dimensions } }
        : {}),
    });

    const embeddings = (response.embeddings ?? []).map((e) => e.values ?? []);

    return success({
      embeddings,
      model: config.model,
      // Google Gemini embeddings API does not return token usage in the
      // response. Cost cannot be auto-computed without a separate
      // countTokens() call.
    });
  } catch (err) {
    return failure(
      err instanceof Error ? err.message : "Google embedding request failed",
    );
  }
}
```

Note: Google's `embedContent` does not return token usage in the Gemini API response (Vertex returns `metadata.billableCharacterCount` only). Cost estimation is omitted.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/smoltalk && npx vitest run lib/embed/google.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/smoltalk/lib/embed/google.ts packages/smoltalk/lib/embed/google.test.ts
git commit -m "feat(embed): implement Google embeddings provider"
```

---

### Task 6: Implement Ollama Embeddings Provider

**Files:**
- Create: `packages/smoltalk/lib/embed/ollama.ts`
- Create: `packages/smoltalk/lib/embed/ollama.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("ollama", () => {
  return {
    Ollama: vi.fn().mockImplementation(() => ({
      embed: vi.fn().mockResolvedValue({
        model: "nomic-embed-text",
        embeddings: [
          [0.1, 0.2, 0.3],
          [0.4, 0.5, 0.6],
        ],
        prompt_eval_count: 4,
        total_duration: 0,
        load_duration: 0,
      }),
    })),
  };
});

import { ollamaEmbed } from "./ollama.js";

describe("ollamaEmbed", () => {
  it("returns embeddings for batch input", async () => {
    const result = await ollamaEmbed(
      ["hello", "world"],
      { model: "nomic-embed-text" },
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.embeddings).toHaveLength(2);
      expect(result.value.embeddings[0]).toEqual([0.1, 0.2, 0.3]);
      expect(result.value.model).toBe("nomic-embed-text");
      expect(result.value.tokenUsage?.inputTokens).toBe(4);
    }
  });

  it("passes dimensions when specified", async () => {
    const { Ollama } = await import("ollama");
    const mockInstance = new Ollama({} as any);

    await ollamaEmbed(
      ["hello"],
      { model: "nomic-embed-text", dimensions: 256 },
    );

    expect(mockInstance.embed).toHaveBeenCalledWith(
      expect.objectContaining({ dimensions: 256 }),
    );
  });

  it("returns failure on API error", async () => {
    const { Ollama } = await import("ollama");
    vi.mocked(Ollama).mockImplementationOnce(() => ({
      embed: vi.fn().mockRejectedValue(new Error("connection refused")),
    }) as any);

    const result = await ollamaEmbed(
      ["hello"],
      { model: "nomic-embed-text" },
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("connection refused");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/smoltalk && npx vitest run lib/embed/ollama.test.ts`
Expected: FAIL — `ollama.ts` doesn't exist yet.

- [ ] **Step 3: Implement `lib/embed/ollama.ts`**

```typescript
import { Ollama } from "ollama";
import { EmbedConfig, EmbedResult } from "../embed.js";
import { Result, success, failure } from "../types/result.js";
import { DEFAULT_OLLAMA_HOST } from "../clients/ollama.js";

export async function ollamaEmbed(
  inputs: string[],
  config: EmbedConfig,
  apiKey?: string,
  ollamaHost?: string,
): Promise<Result<EmbedResult>> {
  try {
    let client: Ollama;
    if (apiKey) {
      client = new Ollama({
        host: "https://cloud.ollama.com",
        headers: { Authorization: "Bearer " + apiKey },
      });
    } else {
      client = new Ollama({ host: ollamaHost || DEFAULT_OLLAMA_HOST });
    }

    const response = await client.embed({
      model: config.model,
      input: inputs,
      ...(config.dimensions !== undefined
        ? { dimensions: config.dimensions }
        : {}),
    });

    return success({
      embeddings: response.embeddings,
      model: response.model,
      tokenUsage: {
        inputTokens: response.prompt_eval_count ?? 0,
        outputTokens: 0,
      },
    });
  } catch (err) {
    return failure(
      err instanceof Error ? err.message : "Ollama embedding request failed",
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/smoltalk && npx vitest run lib/embed/ollama.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/smoltalk/lib/embed/ollama.ts packages/smoltalk/lib/embed/ollama.test.ts
git commit -m "feat(embed): implement Ollama embeddings provider"
```

---

### Task 7: Implement the `embed()` Public Function

**Files:**
- Modify: `packages/smoltalk/lib/embed.ts` (add the `embed` function to the existing types file)
- Create: `packages/smoltalk/lib/embed.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock provider implementations
vi.mock("./embed/openai.js", () => ({
  openaiEmbed: vi.fn().mockResolvedValue({
    success: true,
    value: {
      embeddings: [[0.1, 0.2]],
      model: "text-embedding-3-small",
      tokenUsage: { inputTokens: 5, outputTokens: 0 },
    },
  }),
}));

vi.mock("./embed/google.js", () => ({
  googleEmbed: vi.fn().mockResolvedValue({
    success: true,
    value: {
      embeddings: [[0.3, 0.4]],
      model: "gemini-embedding-001",
    },
  }),
}));

vi.mock("./embed/ollama.js", () => ({
  ollamaEmbed: vi.fn().mockResolvedValue({
    success: true,
    value: {
      embeddings: [[0.5, 0.6]],
      model: "nomic-embed-text",
    },
  }),
}));

import { embed } from "./embed.js";
import { openaiEmbed } from "./embed/openai.js";
import { googleEmbed } from "./embed/google.js";
import { ollamaEmbed } from "./embed/ollama.js";

describe("embed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes single string input to array", async () => {
    const result = await embed("hello", {
      model: "text-embedding-3-small",
      openAiApiKey: "test-key",
    });

    expect(result.success).toBe(true);
    expect(openaiEmbed).toHaveBeenCalledWith(
      ["hello"],
      expect.anything(),
      "test-key",
    );
  });

  it("dispatches to OpenAI for OpenAI models", async () => {
    await embed(["hello"], {
      model: "text-embedding-3-small",
      openAiApiKey: "test-key",
    });

    expect(openaiEmbed).toHaveBeenCalled();
    expect(googleEmbed).not.toHaveBeenCalled();
  });

  it("dispatches to Google for Gemini models", async () => {
    await embed(["hello"], {
      model: "gemini-embedding-001",
      googleApiKey: "test-key",
    });

    expect(googleEmbed).toHaveBeenCalled();
    expect(openaiEmbed).not.toHaveBeenCalled();
  });

  it("dispatches to Ollama when provider is explicitly set", async () => {
    await embed(["hello"], {
      model: "nomic-embed-text",
      provider: "ollama",
    });

    expect(ollamaEmbed).toHaveBeenCalled();
  });

  it("returns failure for unsupported provider", async () => {
    const result = await embed(["hello"], {
      model: "some-model",
      provider: "anthropic",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("does not support embeddings");
    }
  });

  it("returns failure for missing API key", async () => {
    // Clear env vars for this test
    const orig = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const result = await embed(["hello"], {
      model: "text-embedding-3-small",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("API key");
    }

    process.env.OPENAI_API_KEY = orig;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/smoltalk && npx vitest run lib/embed.test.ts`
Expected: FAIL — `embed()` function not implemented yet.

- [ ] **Step 3: Add `embed()` function to `lib/embed.ts`**

Add the function implementation below the existing types in `lib/embed.ts`:

```typescript
import { Provider } from "./models.js";
import { Result, failure } from "./types/result.js";
import { TokenUsage } from "./types/tokenUsage.js";
import { CostEstimate } from "./types/costEstimate.js";
import { resolveProvider, resolveApiKey } from "./util/provider.js";
import { openaiEmbed } from "./embed/openai.js";
import { googleEmbed } from "./embed/google.js";
import { ollamaEmbed } from "./embed/ollama.js";

// ... existing type definitions ...

export async function embed(
  input: string | string[],
  config: EmbedConfig,
): Promise<Result<EmbedResult>> {
  const inputs = Array.isArray(input) ? input : [input];

  let provider: string;
  try {
    provider = resolveProvider(config.model, config.provider);
  } catch (err) {
    return failure(
      err instanceof Error ? err.message : "Failed to resolve provider",
    );
  }

  const apiKey = resolveApiKey(provider, config);

  switch (provider) {
    case "openai":
    case "openai-responses": {
      if (!apiKey) {
        return failure(
          "No OpenAI API key provided. Set openAiApiKey in config or the OPENAI_API_KEY environment variable.",
        );
      }
      return openaiEmbed(inputs, config, apiKey);
    }
    case "google": {
      if (!apiKey) {
        return failure(
          "No Google API key provided. Set googleApiKey in config or the GEMINI_API_KEY environment variable.",
        );
      }
      return googleEmbed(inputs, config, apiKey);
    }
    case "ollama":
      return ollamaEmbed(inputs, config, apiKey, config.ollamaHost);
    default:
      return failure(
        `Provider "${provider}" does not support embeddings`,
      );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/smoltalk && npx vitest run lib/embed.test.ts`
Expected: PASS.

- [ ] **Step 5: Run all tests to check for regressions**

Run: `cd packages/smoltalk && pnpm test`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add packages/smoltalk/lib/embed.ts packages/smoltalk/lib/embed.test.ts
git commit -m "feat(embed): implement embed() public function with provider dispatch"
```

---

### Task 8: Export from Package

**Files:**
- Modify: `packages/smoltalk/lib/index.ts`

- [ ] **Step 1: Add embed exports to `lib/index.ts`**

To match the existing convention (everything in `lib/index.ts` uses `export *`):

```typescript
export * from "./embed.js";
```

- [ ] **Step 2: Run typecheck and all tests**

Run: `cd packages/smoltalk && pnpm typecheck && pnpm test`
Expected: All pass.

- [ ] **Step 3: Verify the build works**

Run: `cd packages/smoltalk && pnpm build`
Expected: Builds successfully.

- [ ] **Step 4: Commit**

```bash
git add packages/smoltalk/lib/index.ts
git commit -m "feat(embed): export embed, EmbedConfig, EmbedResult from package"
```

---

### Task 9: Live Smoke Tests

**Files:**
- Create: `packages/smoltalk/lib/embed/embed.live.test.ts`

- [ ] **Step 1: Write live smoke tests**

```typescript
/**
 * Real-API smoke tests for the embeddings feature.
 * Runs only with API keys set, via `pnpm test:live`.
 */
import { describe, it, expect } from "vitest";
import { embed } from "../embed.js";

const TIMEOUT = 30_000;

describe.runIf(Boolean(process.env.OPENAI_API_KEY)).concurrent(
  "OpenAI Embeddings - real API",
  () => {
    it("single string", { timeout: TIMEOUT }, async () => {
      const r = await embed("hello world", {
        model: "text-embedding-3-small",
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.value.embeddings).toHaveLength(1);
        expect(r.value.embeddings[0].length).toBeGreaterThan(0);
        expect(r.value.tokenUsage?.inputTokens).toBeGreaterThan(0);
        expect(r.value.costEstimate?.totalCost).toBeGreaterThan(0);
      }
    });

    it("batch input", { timeout: TIMEOUT }, async () => {
      const r = await embed(["hello", "world", "foo"], {
        model: "text-embedding-3-small",
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.value.embeddings).toHaveLength(3);
      }
    });

    it("with dimensions", { timeout: TIMEOUT }, async () => {
      const r = await embed("hello", {
        model: "text-embedding-3-small",
        dimensions: 256,
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.value.embeddings[0]).toHaveLength(256);
      }
    });
  },
);

describe.runIf(Boolean(process.env.GEMINI_API_KEY)).concurrent(
  "Google Embeddings - real API",
  () => {
    it("single string", { timeout: TIMEOUT }, async () => {
      const r = await embed("hello world", {
        model: "gemini-embedding-001",
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.value.embeddings).toHaveLength(1);
        expect(r.value.embeddings[0].length).toBeGreaterThan(0);
      }
    });

    it("batch input", { timeout: TIMEOUT }, async () => {
      const r = await embed(["hello", "world"], {
        model: "gemini-embedding-001",
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.value.embeddings).toHaveLength(2);
      }
    });
  },
);
```

- [ ] **Step 2: Verify the live test file is excluded from `pnpm test` and included in `pnpm test:live`**

Check `packages/smoltalk/package.json` scripts:
- `test` should exclude `*.live.test.ts` (existing `--exclude` pattern covers this)
- `test:live` runs `vitest run lib/clients/*.live.test.ts` — this won't pick up `lib/embed/embed.live.test.ts`. Update the `test:live` script to also include embed live tests:

```json
"test:live": "vitest run lib/clients/*.live.test.ts lib/embed/*.live.test.ts"
```

- [ ] **Step 3: Run unit tests to make sure live tests are excluded**

Run: `cd packages/smoltalk && pnpm test`
Expected: All pass, no live tests run.

- [ ] **Step 4: Commit**

```bash
git add packages/smoltalk/lib/embed/embed.live.test.ts packages/smoltalk/package.json
git commit -m "test(embed): add live smoke tests for OpenAI and Google embeddings"
```
