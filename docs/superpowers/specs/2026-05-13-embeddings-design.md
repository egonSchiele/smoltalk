# Embeddings Support for Smoltalk

## Overview

Add an `embed()` function to smoltalk for computing embeddings across multiple providers. This follows a function-based architecture (no classes) since embeddings are simple request/response operations without the complexity that justifies the text generation class hierarchy.

## Public API

```typescript
import { embed } from "smoltalk";

// Single string
const result = await embed("hello world", {
  model: "text-embedding-3-small",
});
// result.value.embeddings → [number[]]

// Batch
const result = await embed(["hello", "world", "foo"], {
  model: "text-embedding-3-small",
  dimensions: 256,
});
// result.value.embeddings → [number[], number[], number[]]
```

### Function Signature

```typescript
function embed(
  input: string | string[],
  config: EmbedConfig,
): Promise<Result<EmbedResult>>;
```

`input` is a separate argument from config for ergonomics. Internally, single strings are normalized to `[input]` before calling the provider.

## Types

### EmbedConfig

```typescript
type EmbedConfig = {
  model: string;
  provider?: Provider;
  dimensions?: number;

  // API keys
  openAiApiKey?: string;
  googleApiKey?: string;
  ollamaApiKey?: string;

  // Ollama-specific
  ollamaBaseUrl?: string;

  // Plugin support
  metadata?: Record<string, unknown>;
};
```

No `anthropicApiKey` — Anthropic does not offer an embeddings API.

The `dimensions` field maps to each provider's native parameter:
- OpenAI: `dimensions`
- Google: `outputDimensionality`
- Ollama: not supported (ignored)

### EmbedResult

```typescript
type EmbedResult = {
  embeddings: number[][];
  model: string;
  tokenUsage?: TokenUsage;
  costEstimate?: CostEstimate;
};
```

- `embeddings` is always `number[][]`, even for single-string input (one-element array).
- `TokenUsage` and `CostEstimate` are the existing types from `types.ts`. Only `inputTokens` will be populated since embeddings have no output tokens.
- Wrapped in `Result<EmbedResult>` for consistency with the rest of the library.

## Architecture

### File Structure

```
lib/
  embed.ts                  # embed() public function + provider dispatch
  embed/
    openai.ts               # openaiEmbed()
    google.ts               # googleEmbed()
    ollama.ts               # ollamaEmbed()
  util/
    provider.ts             # NEW: resolveProvider(), resolveApiKey()
```

### Provider Dispatch

`embed.ts` resolves the provider and dispatches to the appropriate function:

```typescript
export async function embed(
  input: string | string[],
  config: EmbedConfig,
): Promise<Result<EmbedResult>> {
  const inputs = Array.isArray(input) ? input : [input];
  const provider = resolveProvider(config.model, config.provider);
  const apiKey = resolveApiKey(provider, config);

  switch (provider) {
    case "openai":
    case "openai-responses":
      return openaiEmbed(inputs, config, apiKey);
    case "google":
      return googleEmbed(inputs, config, apiKey);
    case "ollama":
      return ollamaEmbed(inputs, config, apiKey, config.ollamaBaseUrl);
    default:
      return failure(`Provider "${provider}" does not support embeddings`);
  }
}
```

### Shared Utilities Extraction

`resolveProvider()` and `resolveApiKey()` are extracted from the existing `getClient()` in `client.ts` into `lib/util/provider.ts`. Both the existing text generation classes and the new embed function use these utilities. `getClient()` is refactored to call them internally — no behavior change.

### Existing Code Unchanged

The text generation class hierarchy (`BaseClient`, `OpenAIClient`, `GoogleClient`, etc.) stays exactly as is. The class-based architecture is justified for text generation due to shared complexity (tool loops, response format retries, streaming). Embeddings doesn't need any of that.

## Provider Implementations

Each provider function is ~15-20 lines: construct SDK client, call API, map response.

### OpenAI

Uses `client.embeddings.create()` from the `openai` SDK. Passes `dimensions` directly. Response contains `data[].embedding` arrays and `usage.prompt_tokens`.

### Google

Uses `client.models.batchEmbedContents()` from `@google/genai`. Maps `dimensions` to `outputDimensionality`. Handles batching natively.

### Ollama

Uses the `/api/embed` endpoint which accepts an array of strings natively.

### Cost Calculation

A helper looks up the model in `embeddingsModels`, grabs `tokenCost`, and computes `inputTokens * tokenCost / 1_000_000`. Same pattern as text generation but simpler (input cost only).

## Model Registry Updates

Add to the existing `embeddingsModels` array in `models.ts`:

| Model | Provider | Cost per 1M tokens |
|-------|----------|-------------------|
| `text-embedding-3-small` | OpenAI | $0.02 (already exists) |
| `text-embedding-3-large` | OpenAI | $0.13 |
| `gemini-embedding-001` | Google | $0.15 |
| `gemini-embedding-2-preview` | Google | $0.20 |

Note: `text-embedding-004` (Google) was shut down January 2026 and should not be added.

Ollama models are dynamic/unregistered, matching the existing pattern for Ollama text models.

## Testing

### Unit Tests

- `lib/embed.test.ts` — provider dispatch, input normalization (string to array), error cases (unsupported provider, missing API key)
- `lib/util/provider.test.ts` — tests for the extracted `resolveProvider()` and `resolveApiKey()` utilities, ensuring no regression in text generation behavior

### Live Smoke Tests

- `lib/embed/embed.live.test.ts` — real API calls to OpenAI, Google, and Ollama
  - Gated by API key env vars using `describe.runIf(haveKey)`
  - Tests: single string, batch input, `dimensions` parameter
  - Follows the `liveProviderSuite()` pattern from existing live tests

## Exports

Add to `lib/index.ts`:
- `embed` function
- `EmbedConfig` type
- `EmbedResult` type

## Future Work

Image generation would follow this same function-based pattern: a public `image()` function dispatching to provider-specific functions, with its own dedicated config type.
