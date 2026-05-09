# Smoltalk Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip Smoltalk back to a simple unified wrapper around LLM provider APIs by removing the strategies system, middleware, and latency tracker, and unifying `SmolConfig` + `PromptConfig` into one config type. Bump to `0.1.0`.

**Architecture:** Six sequential tasks, each one leaving `pnpm typecheck && pnpm test` green so the work can be committed and reverted independently. Order is chosen so each step's removals don't break code that subsequent steps still need.

**Tech Stack:** TypeScript, ES Modules, vitest, pnpm.

**Spec:** See `docs/superpowers/specs/2026-05-08-smoltalk-cleanup-design.md` for the full design rationale.

**Working directory:** `/Users/adit/smoltalk` for all commands.

---

## Task 1: Remove strategies and `onStrategyStart` hook

**Files:**
- Delete: `lib/strategies/` (entire directory: `baseStrategy.ts`, `fallbackStrategy.ts`, `fastestStrategy.ts`, `idStrategy.ts`, `raceStrategy.ts`, `randomStrategy.ts`, `timeoutStrategy.ts`, `index.ts`, `types.ts`, `strategies.test.ts`)
- Modify: `lib/models.ts` (add `ModelNameSchema`, previously in `lib/strategies/types.ts`)
- Modify: `lib/model.ts` (remove `strategies/types.js` import)
- Modify: `lib/types.ts` (drop `Strategy`/`StrategyJSON` imports, simplify `ModelParam`, drop `onStrategyStart` from hooks)
- Modify: `lib/functions.ts` (drop `getStrategy`/`getFreshStrategy`, inline client call, keep middleware/splitConfig for now)
- Modify: `lib/index.ts` (drop strategies re-export)
- Modify: `lib/model.test.ts` (drop any test that exercised the strategy/object branch — none currently exist per inspection, but verify)

- [ ] **Step 1.1: Move `ModelNameSchema` to `lib/models.ts`**

Append at the end of `lib/models.ts`:

```ts
import { z } from "zod";

export const ModelNameSchema = z
  .string()
  .regex(
    /^[a-zA-Z0-9._:-]+$/,
    "Model name must only contain letters, numbers, dots, underscores, hyphens, and colons",
  );
```

(Check whether `z` is already imported at the top of `models.ts`. If yes, just add the schema; if no, add the import.)

- [ ] **Step 1.2: Update `lib/model.ts` to import the schema from its new home**

Change the import line at the top of `lib/model.ts` from:
```ts
import { ModelNameSchema } from "./strategies/types.js";
```
to:
```ts
import { ModelNameSchema } from "./models.js";
```

- [ ] **Step 1.3: Update `lib/types.ts` to drop strategy types**

In `lib/types.ts`:

- Remove the import line `import { Strategy, StrategyJSON } from "./strategies/types.js";`
- Change `export type ModelParam = ModelName | Strategy | StrategyJSON;` to `export type ModelParam = ModelName;`
- Remove the `onStrategyStart` line from the `hooks` object inside `SmolConfig`. The line to remove is:
  ```ts
  onStrategyStart: (strategy: Strategy, config: SmolPromptConfig) => void;
  ```
- The `model: ModelParam;` line in `SmolConfig` stays as-is for now (still typed via the alias). It will be flattened to `model: ModelName` directly in Task 4.

- [ ] **Step 1.4: Rewrite `lib/functions.ts` to drop strategy plumbing**

Replace the contents of `lib/functions.ts` with:

```ts
import {
  BaseMessage,
  Message,
  messageFromJSON,
} from "./classes/message/index.js";
import { getClient } from "./client.js";
import { executeMiddlewareSync, executeMiddlewareStream } from "./middleware.js";
import { Model } from "./model.js";
import {
  PromptConfig,
  PromptResult,
  SmolPromptConfig,
  StreamChunk,
} from "./types.js";
import { Result } from "./types/result.js";
import { getLogger } from "./util/logger.js";

export function splitConfig(config: SmolPromptConfig): {
  smolConfig: Parameters<typeof getClient>[0];
  promptConfig: PromptConfig;
} {
  const {
    openAiApiKey,
    googleApiKey,
    ollamaApiKey,
    anthropicApiKey,
    ollamaHost,
    model: rawModel,
    provider,
    logLevel,
    statelog,
    metadata,
    hooks,
    llamaCppModelDir,
    middleware,
    ...promptConfig
  } = config;

  const _model = new Model(rawModel as any);
  const model = _model.getResolvedModel();

  return {
    smolConfig: {
      openAiApiKey,
      googleApiKey,
      ollamaApiKey,
      anthropicApiKey,
      ollamaHost,
      model,
      provider,
      logLevel,
      statelog,
      metadata,
      hooks,
      llamaCppModelDir,
    },
    promptConfig,
  };
}

function fixMessagesIfNecessary(messages: any[]): Message[] {
  if (messages && messages.length > 0) {
    if (!(messages[0] instanceof BaseMessage)) {
      getLogger().warn("Messages are not instances of smoltalk.BaseMessage");
      return messages.map((m) => messageFromJSON(m));
    }
  }
  return messages;
}

function runSync(config: SmolPromptConfig): Promise<Result<PromptResult>> {
  const { smolConfig, promptConfig } = splitConfig(config);
  return getClient(smolConfig).textSync(promptConfig);
}

function runStream(config: SmolPromptConfig): AsyncGenerator<StreamChunk> {
  const { smolConfig, promptConfig } = splitConfig(config);
  return getClient(smolConfig).textStream(promptConfig);
}

export function text(
  config: SmolPromptConfig & { stream: true },
): AsyncGenerator<StreamChunk>;
export function text(
  config: SmolPromptConfig & { stream?: false },
): Promise<Result<PromptResult>>;
export function text(
  config: SmolPromptConfig,
): Promise<Result<PromptResult>> | AsyncGenerator<StreamChunk> {
  if (config.stream) return textStream(config);
  return textSync(config);
}

export async function textSync(
  config: SmolPromptConfig,
): Promise<Result<PromptResult>> {
  config.messages = fixMessagesIfNecessary(config.messages);

  if (config.middleware && config.middleware.checks.length > 0) {
    const middlewareResult = await executeMiddlewareSync(config, runSync, runSync);
    if (middlewareResult) return middlewareResult;
  }

  const { middleware: _, ...rest } = config;
  return runSync(rest as SmolPromptConfig);
}

export async function* textStream(
  config: SmolPromptConfig,
): AsyncGenerator<StreamChunk> {
  config.messages = fixMessagesIfNecessary(config.messages);

  if (config.middleware && config.middleware.checks.length > 0) {
    yield* executeMiddlewareStream(config, runStream, runSync);
    return;
  }

  const { middleware: _, ...rest } = config;
  yield* runStream(rest as SmolPromptConfig);
}
```

Notes on this rewrite:
- The `BaseStrategy`, `fromJSON`, `Strategy`, `StrategyJSON`, `ModelParam` imports are gone.
- `getStrategy()` and `getFreshStrategy()` are gone.
- The middleware path now uses `runSync`/`runStream` helpers that go directly through `getClient()`.
- `splitConfig`, `fixMessagesIfNecessary`, and middleware support remain (they go away in Tasks 2 and 4).

- [ ] **Step 1.5: Update `lib/index.ts`**

Remove the line:
```ts
export * from "./strategies/index.js";
```
Leave the `latencyTracker` and `MiddlewareConfig` exports for now (they go away in Tasks 2 and 3).

- [ ] **Step 1.6: Delete the `lib/strategies/` directory**

```bash
rm -rf lib/strategies
```

- [ ] **Step 1.7: Verify**

```bash
pnpm typecheck
pnpm test
```

Both should pass. If `pnpm test` reports failures from the deleted `strategies.test.ts`, ensure the file was actually removed (the directory delete in 1.6 should have handled it).

- [ ] **Step 1.8: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
remove strategies and onStrategyStart hook

Drop the strategies/ directory (race, fallback, fastest, etc.) and the
onStrategyStart hook. ModelNameSchema moves to lib/models.ts.
EOF
)"
```

---

## Task 2: Remove middleware

**Files:**
- Delete: `lib/middleware.ts`, `lib/middleware.test.ts`
- Modify: `lib/types.ts` (drop `MiddlewareConfig` import and `middleware` field on `SmolConfig`)
- Modify: `lib/functions.ts` (drop middleware branches)
- Modify: `lib/index.ts` (drop middleware re-exports)

- [ ] **Step 2.1: Update `lib/types.ts`**

In `lib/types.ts`:
- Remove `import type { MiddlewareConfig } from "./middleware.js";` from the imports.
- Remove this block from `SmolConfig`:
  ```ts
  /** Middleware checks that run LLM-based validation on the prompt before or alongside the main call. */
  middleware?: MiddlewareConfig;
  ```

- [ ] **Step 2.2: Simplify `lib/functions.ts`**

Replace `lib/functions.ts` with:

```ts
import {
  BaseMessage,
  Message,
  messageFromJSON,
} from "./classes/message/index.js";
import { getClient } from "./client.js";
import { Model } from "./model.js";
import {
  PromptConfig,
  PromptResult,
  SmolPromptConfig,
  StreamChunk,
} from "./types.js";
import { Result } from "./types/result.js";
import { getLogger } from "./util/logger.js";

export function splitConfig(config: SmolPromptConfig): {
  smolConfig: Parameters<typeof getClient>[0];
  promptConfig: PromptConfig;
} {
  const {
    openAiApiKey,
    googleApiKey,
    ollamaApiKey,
    anthropicApiKey,
    ollamaHost,
    model: rawModel,
    provider,
    logLevel,
    statelog,
    metadata,
    hooks,
    llamaCppModelDir,
    ...promptConfig
  } = config;

  const _model = new Model(rawModel as any);
  const model = _model.getResolvedModel();

  return {
    smolConfig: {
      openAiApiKey,
      googleApiKey,
      ollamaApiKey,
      anthropicApiKey,
      ollamaHost,
      model,
      provider,
      logLevel,
      statelog,
      metadata,
      hooks,
      llamaCppModelDir,
    },
    promptConfig,
  };
}

function fixMessagesIfNecessary(messages: any[]): Message[] {
  if (messages && messages.length > 0) {
    if (!(messages[0] instanceof BaseMessage)) {
      getLogger().warn("Messages are not instances of smoltalk.BaseMessage");
      return messages.map((m) => messageFromJSON(m));
    }
  }
  return messages;
}

export function text(
  config: SmolPromptConfig & { stream: true },
): AsyncGenerator<StreamChunk>;
export function text(
  config: SmolPromptConfig & { stream?: false },
): Promise<Result<PromptResult>>;
export function text(
  config: SmolPromptConfig,
): Promise<Result<PromptResult>> | AsyncGenerator<StreamChunk> {
  if (config.stream) return textStream(config);
  return textSync(config);
}

export async function textSync(
  config: SmolPromptConfig,
): Promise<Result<PromptResult>> {
  config.messages = fixMessagesIfNecessary(config.messages);
  const { smolConfig, promptConfig } = splitConfig(config);
  return getClient(smolConfig).textSync(promptConfig);
}

export async function* textStream(
  config: SmolPromptConfig,
): AsyncGenerator<StreamChunk> {
  config.messages = fixMessagesIfNecessary(config.messages);
  const { smolConfig, promptConfig } = splitConfig(config);
  yield* getClient(smolConfig).textStream(promptConfig);
}
```

The `executeMiddlewareSync`/`executeMiddlewareStream` imports and the middleware destructure (`middleware: _, ...rest`) are gone. `splitConfig` no longer destructures `middleware`.

- [ ] **Step 2.3: Update `lib/index.ts`**

Remove the line:
```ts
export type { MiddlewareCheck, MiddlewareConfig, MiddlewareResult } from "./middleware.js";
```

- [ ] **Step 2.4: Delete middleware files**

```bash
rm lib/middleware.ts lib/middleware.test.ts
```

- [ ] **Step 2.5: Verify**

```bash
pnpm typecheck
pnpm test
```

- [ ] **Step 2.6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
remove middleware

Drop lib/middleware.ts and the middleware field on SmolConfig. Middleware
was an LLM-based validation gate that no longer fits the simple-wrapper
goal.
EOF
)"
```

---

## Task 3: Remove latency tracker

**Files:**
- Delete: `lib/latencyTracker.ts`, `lib/latencyTracker.test.ts`
- Modify: `lib/clients/baseClient.ts` (drop `latencyTracker` import, remove `recordLatency` private method, remove inline call in `textStream`)
- Modify: `lib/index.ts` (drop `latencyTracker` and `LatencySample` re-exports)

- [ ] **Step 3.1: Update `lib/clients/baseClient.ts`**

Remove the import line:
```ts
import { latencyTracker } from "../latencyTracker.js";
```

Delete the entire `recordLatency` private method (around lines 188–195):
```ts
private recordLatency(startTime: number, result: Result<PromptResult>): void {
  if (!result.success) return;
  const outputTokens = result.value.usage?.outputTokens;
  if (!outputTokens || outputTokens <= 0) return;
  const elapsedMs = performance.now() - startTime;
  latencyTracker.record(this.config.model, elapsedMs, outputTokens);
}
```

Find any call site of `this.recordLatency(...)` in `baseClient.ts` and remove the line. (Search for `recordLatency` to locate.)

In the `textStream` method, find the inline `latencyTracker.record(...)` block (around lines 425–432):
```ts
for await (const chunk of this._textStream(newPromptConfig)) {
  if (chunk.type === "done") {
    const outputTokens = chunk.result.usage?.outputTokens;
    if (outputTokens && outputTokens > 0) {
      const elapsedMs = performance.now() - startTime;
      latencyTracker.record(this.config.model, elapsedMs, outputTokens);
    }
  }
  yield chunk;
}
```

Replace it with the simpler:
```ts
for await (const chunk of this._textStream(newPromptConfig)) {
  yield chunk;
}
```

If a `const startTime = performance.now();` line right above this loop is now unused, delete it too. (Verify it isn't referenced elsewhere in the same method first.)

- [ ] **Step 3.2: Update `lib/index.ts`**

Remove these two lines:
```ts
export { latencyTracker } from "./latencyTracker.js";
export type { LatencySample } from "./latencyTracker.js";
```

- [ ] **Step 3.3: Delete latency tracker files**

```bash
rm lib/latencyTracker.ts lib/latencyTracker.test.ts
```

- [ ] **Step 3.4: Verify**

```bash
pnpm typecheck
pnpm test
```

- [ ] **Step 3.5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
remove latency tracker

The latency tracker was only consumed by fastestStrategy (already removed)
and BaseClient post-call recording. Drop both.
EOF
)"
```

---

## Task 4: Unify `SmolConfig` and `PromptConfig`

**Files:**
- Modify: `lib/types.ts` (merge the two types into one `SmolConfig`; delete `PromptConfig`, `SmolPromptConfig`, `ResolvedSmolConfig`, `BaseClientConfig`, `ModelParam`; update `SmolClient` interface)
- Modify: `lib/functions.ts` (delete `splitConfig`, simplify `text*` to take `SmolConfig`)
- Modify: `lib/clients/baseClient.ts` (constructor takes `SmolConfig`; methods take `SmolConfig`; field type updates)
- Modify: `lib/clients/openai.ts`, `lib/clients/openaiResponses.ts`, `lib/clients/google.ts`, `lib/clients/anthropic.ts`, `lib/clients/ollama.ts`, `lib/clients/llamaCpp.ts` (constructor signature changes; method signature changes)
- Modify: `lib/client.ts` (`getClient()` signature: `(config: SmolConfig) => SmolClient`)
- Modify: `lib/clients/baseClient.test.ts`, `lib/client.test.ts`, `lib/classes/message/message.test.ts`, `lib/classes/ToolCall.test.ts` (any test that constructs a config explicitly typed as `PromptConfig` or `SmolPromptConfig` updates to `SmolConfig`)

- [ ] **Step 4.1: Rewrite `lib/types.ts`**

The new file (preserving every kept field, dropping the split):

```ts
export * from "./types/result.js";
import { LogLevel } from "egonlog";
import z, { ZodType } from "zod";
import { Message } from "./classes/message/index.js";
import { ToolCall } from "./classes/ToolCall.js";
import { Model } from "./model.js";
import { ModelName } from "./models.js";
import { Result } from "./types/result.js";
import { TokenUsage } from "./types/tokenUsage.js";
import { CostEstimate } from "./types/costEstimate.js";
export * from "./types/costEstimate.js";
export * from "./types/tokenUsage.js";

export type SmolConfig = {
  /** The model to use. */
  model: ModelName;

  /** Override the provider for the given model (e.g., use a custom endpoint for an OpenAI-compatible model). */
  provider?: string;

  /** API key for OpenAI. Required when using OpenAI models. */
  openAiApiKey?: string;

  /** API key for Google Gemini. Required when using Google models. */
  googleApiKey?: string;

  /** API key for Anthropic. Required when using Anthropic/Claude models. */
  anthropicApiKey?: string;

  /** API key for Ollama. Only needed when connecting to a cloud-hosted Ollama instance. */
  ollamaApiKey?: string;

  /** Base URL for the Ollama server. Defaults to localhost if not set. (Ollama only) */
  ollamaHost?: string;

  /** Directory path for Llama.cpp models. Required when using the Llama.cpp client. */
  llamaCppModelDir?: string;

  /** Log level for internal debug logging. */
  logLevel?: LogLevel;

  /** Configuration for Statelog observability/tracing integration. */
  statelog?: Partial<{
    host: string;
    projectId: string;
    traceId: string;
    debugMode: boolean;
    apiKey: string;
  }>;

  /** Lifecycle hooks called at various points during execution. */
  hooks?: Partial<{
    onStart: (config: SmolConfig) => void;
    onToolCall: (toolCall: ToolCall) => void;
    onEnd: (result: PromptResult) => void;
    onError: (error: Error) => void;
  }>;

  /** Arbitrary metadata passed to custom model providers. */
  metadata?: Record<string, any>;

  // ── Per-call fields (formerly PromptConfig) ───────────────────────────

  /** The conversation messages to send to the model. */
  messages: Message[];

  /** Tools (functions) the model can call. */
  tools?: {
    name: string;
    description?: string;
    schema: ZodType;
  }[];

  /** Maximum number of tokens the model can generate in its response. */
  maxTokens?: number;

  /** Sampling temperature (0-2). (OpenAI only) */
  temperature?: number;

  /** Number of alternative completions to generate. */
  numSuggestions?: number;

  /** Whether the model can call multiple tools in a single turn. (OpenAI Responses API only) */
  parallelToolCalls?: boolean;

  /** A Zod schema to constrain the model's output to structured JSON matching the schema. */
  responseFormat?: ZodType;

  /** If true, returns an AsyncGenerator of StreamChunks instead of a single result. */
  stream?: boolean;

  /** Enable extended thinking / thought signatures. (Anthropic and Google only) */
  thinking?: {
    enabled: boolean;
    budgetTokens?: number;
  };

  /** Provider-agnostic reasoning effort level. */
  reasoningEffort?: "low" | "medium" | "high";

  responseFormatOptions?: Partial<{
    name: string;
    strict: boolean;
    numRetries: number;
    allowExtraKeys: boolean;
  }>;

  /** Arbitrary provider-specific attributes passed directly to the underlying API call. */
  rawAttributes?: Record<string, any>;

  /** If set, returns a failure when the number of messages exceeds this limit. */
  maxMessages?: number;

  /** An AbortSignal for cancelling the request. */
  abortSignal?: AbortSignal;

  /** Define behavior if too many repeated tool calls are detected (loop prevention). */
  toolLoopDetection?: ToolLoopDetection;
};

export type ToolLoopDetection = {
  enabled: boolean;
  maxCalls: number;
  intervention?:
    | "remove-tool"
    | "remove-all-tools"
    | "throw-error"
    | "halt-execution";
  excludeTools?: string[];
};

export type PromptResult = {
  output: string | null;
  toolCalls: ToolCall[];
  thinkingBlocks?: ThinkingBlock[];
  usage?: TokenUsage;
  cost?: CostEstimate;
  model?: ModelName;
};

export function promptResult({
  output,
  toolCalls,
  thinkingBlocks,
  usage,
  cost,
  model,
}: Partial<PromptResult>): PromptResult {
  return {
    output: output || null,
    toolCalls: toolCalls || [],
    thinkingBlocks: thinkingBlocks,
    usage,
    cost,
    model,
  };
}

export type StreamChunk =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string; signature?: string }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "done"; result: PromptResult }
  | { type: "error"; error: string }
  | { type: "timeout"; error: string };

export interface SmolClient {
  text(
    config: SmolConfig,
  ): Promise<Result<PromptResult>> | AsyncGenerator<StreamChunk>;
  textSync(config: SmolConfig): Promise<Result<PromptResult>>;
  _textSync(config: SmolConfig): Promise<Result<PromptResult>>;
  textStream(config: SmolConfig): AsyncGenerator<StreamChunk>;
  _textStream(config: SmolConfig): AsyncGenerator<StreamChunk>;
}

export type TextPart = {
  type: "text";
  text: string;
};

export type ModelLike = ModelName | Model;

export type ThinkingBlock = {
  text: string;
  signature: string;
};

export const TextPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

export const ThinkingBlockSchema = z.object({
  text: z.string(),
  signature: z.string(),
});
```

Removed exports compared to the previous file: `PromptConfig`, `SmolPromptConfig`, `ResolvedSmolConfig`, `BaseClientConfig`, `ModelParam`. Type `ModelLike` stays since `Model.create()` uses it.

- [ ] **Step 4.2: Rewrite `lib/functions.ts`**

```ts
import {
  BaseMessage,
  Message,
  messageFromJSON,
} from "./classes/message/index.js";
import { getClient } from "./client.js";
import {
  PromptResult,
  SmolConfig,
  StreamChunk,
} from "./types.js";
import { Result } from "./types/result.js";
import { getLogger } from "./util/logger.js";

function fixMessagesIfNecessary(messages: any[]): Message[] {
  if (messages && messages.length > 0) {
    if (!(messages[0] instanceof BaseMessage)) {
      getLogger().warn("Messages are not instances of smoltalk.BaseMessage");
      return messages.map((m) => messageFromJSON(m));
    }
  }
  return messages;
}

export function text(
  config: SmolConfig & { stream: true },
): AsyncGenerator<StreamChunk>;
export function text(
  config: SmolConfig & { stream?: false },
): Promise<Result<PromptResult>>;
export function text(
  config: SmolConfig,
): Promise<Result<PromptResult>> | AsyncGenerator<StreamChunk> {
  if (config.stream) return textStream(config);
  return textSync(config);
}

export async function textSync(
  config: SmolConfig,
): Promise<Result<PromptResult>> {
  config.messages = fixMessagesIfNecessary(config.messages);
  return getClient(config).textSync(config);
}

export async function* textStream(
  config: SmolConfig,
): AsyncGenerator<StreamChunk> {
  config.messages = fixMessagesIfNecessary(config.messages);
  yield* getClient(config).textStream(config);
}
```

`splitConfig` is fully gone. `getClient(config)` now takes the unified `SmolConfig`.

- [ ] **Step 4.3: Update `lib/client.ts` (`getClient` signature)**

Open `lib/client.ts`. The current `getClient()` takes a config typed loosely (it pulled from `splitConfig`'s `smolConfig` output). Update its parameter type to `SmolConfig`. The function body should still work — each `case` instantiates a client with the config — but verify the `provider` resolution logic still reads `config.provider` and `config.model` correctly.

Specifically:
- Change the parameter type from whatever it currently is to `SmolConfig` (imported from `./types.js`).
- Each `new SmolOpenAI(clientConfig)`, `new SmolAnthropic(clientConfig)`, etc. now passes `SmolConfig` to client constructors that will accept `SmolConfig` after Step 4.4.

- [ ] **Step 4.4: Update `lib/clients/baseClient.ts`**

In `baseClient.ts`:

- Change the import line `import { ResolvedSmolConfig, ... } from "../types.js";` — drop `ResolvedSmolConfig` from it. Add `SmolConfig` if not already imported. Remove `PromptConfig` from the import list (it's gone).
- Change `protected config: ResolvedSmolConfig;` to `protected config: SmolConfig;`
- Change `constructor(config: ResolvedSmolConfig) { ... }` to `constructor(config: SmolConfig) { ... }`
- Throughout the file, replace every parameter type `PromptConfig` (in method signatures) with `SmolConfig`. Search the file for `PromptConfig` to find them all (there are several — in `text`, `textSync`, `textStream`, `_textSync`, `_textStream`, `checkMessageLimit`, `extractResponse`, `getAbortSignal`, etc.).

Function bodies don't change — they were already reading fields like `promptConfig.messages`, `promptConfig.maxTokens`. Those fields are now on `SmolConfig`.

- [ ] **Step 4.5: Update each concrete client**

For each of these files:
- `lib/clients/openai.ts`
- `lib/clients/openaiResponses.ts`
- `lib/clients/google.ts`
- `lib/clients/anthropic.ts`
- `lib/clients/ollama.ts`
- `lib/clients/llamaCpp.ts`

Make these changes:
1. In imports, replace any `ResolvedSmolConfig` or `BaseClientConfig` with `SmolConfig`. Replace `PromptConfig` with `SmolConfig`.
2. Constructor signature: change `constructor(config: ResolvedSmolConfig)` (or `BaseClientConfig`) to `constructor(config: SmolConfig)`.
3. Method signatures: every `_textSync(config: PromptConfig)` and `_textStream(config: PromptConfig)` becomes `_textSync(config: SmolConfig)` / `_textStream(config: SmolConfig)`. Same for any helper methods that took `PromptConfig`.
4. Function bodies are unchanged — they already destructure fields that exist on `SmolConfig`.

- [ ] **Step 4.6: Update tests**

Search the test files for `PromptConfig`, `SmolPromptConfig`, `ResolvedSmolConfig`, `BaseClientConfig` and replace each with `SmolConfig`:

```bash
grep -rln "PromptConfig\|SmolPromptConfig\|ResolvedSmolConfig\|BaseClientConfig" lib
```

For each match in a test file, change the type annotation to `SmolConfig`. Test bodies don't need behavioral changes.

- [ ] **Step 4.7: Verify**

```bash
pnpm typecheck
pnpm test
```

If typecheck reports unresolved `PromptConfig` references, search the codebase again — the type is fully gone now.

- [ ] **Step 4.8: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
unify SmolConfig and PromptConfig

Merge the client-level and per-call config types into a single SmolConfig.
Drop splitConfig, ResolvedSmolConfig, BaseClientConfig, SmolPromptConfig,
PromptConfig, ModelParam. Public API unchanged at call sites.
EOF
)"
```

---

## Task 5: Simplify the `Model` class

**Files:**
- Modify: `lib/model.ts` (drop `getResolvedModel`, drop the dual `model`/`resolvedModel` fields)
- Modify: `lib/clients/openai.ts`, `lib/clients/openaiResponses.ts`, `lib/clients/google.ts`, `lib/clients/anthropic.ts`, `lib/clients/ollama.ts`, `lib/clients/llamaCpp.ts` (replace `this.model.getResolvedModel()` with `this.model.getModel()`)
- Modify: `lib/model.test.ts` (drop `getResolvedModel` references if any; otherwise no change)

- [ ] **Step 5.1: Simplify `lib/model.ts`**

Replace the file with:

```ts
import { ModelName, getModel, isTextModel, ModelNameSchema, Provider } from "./models.js";
import { SmolError } from "./smolError.js";
import { ModelLike } from "./types.js";
import { round } from "./util/util.js";

export class Model {
  private model: ModelName;
  private provider?: Provider;

  constructor(model: ModelName, provider?: Provider) {
    if (!ModelNameSchema.safeParse(model).success) {
      throw new SmolError(
        `Model ${JSON.stringify(model)} is not recognized. Please specify a known model name.`,
      );
    }
    this.model = model;
    this.provider = provider || this.lookupProvider();
  }

  getModel(): ModelName {
    return this.model;
  }

  getProvider(): Provider | undefined {
    return this.provider;
  }

  private lookupProvider(): Provider | undefined {
    const modelInfo = getModel(this.model);
    return modelInfo ? (modelInfo.provider as Provider) : undefined;
  }

  calculateCost(usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
  }): {
    inputCost: number;
    outputCost: number;
    cachedInputCost?: number;
    totalCost: number;
    currency: string;
  } | null {
    const model = getModel(this.model);
    if (!model || !isTextModel(model)) {
      return null;
    }

    const inputCost = round(
      (usage.inputTokens * (model.inputTokenCost || 0)) / 1_000_000,
      6,
    );
    const outputCost = round(
      (usage.outputTokens * (model.outputTokenCost || 0)) / 1_000_000,
      6,
    );
    const cachedInputCost =
      usage.cachedInputTokens && model.cachedInputTokenCost
        ? round(
            (usage.cachedInputTokens * model.cachedInputTokenCost) / 1_000_000,
            6,
          )
        : undefined;

    const totalCost = round(inputCost + outputCost + (cachedInputCost || 0), 6);

    return {
      inputCost,
      outputCost,
      cachedInputCost,
      totalCost,
      currency: "USD",
    };
  }

  toString() {
    return `Model(${JSON.stringify(this.model)})`;
  }

  toJSON(): ModelName {
    return this.model;
  }

  static create(model: ModelLike, provider?: Provider): Model {
    if (model instanceof Model) {
      return model;
    }
    return new Model(model, provider);
  }
}
```

What changed:
- The `resolvedModel` private field is gone. There's just `model`.
- `getResolvedModel()` is gone. Callers use `getModel()`.
- `resolveModel()` is gone — its validation moves into the constructor.
- `setProvider()` renamed to `lookupProvider()` and made private (it was misleadingly called "set" when it just looked up and returned).
- `toJSON()` returns `this.model` directly.

- [ ] **Step 5.2: Update each concrete client**

For each of the six client files listed above, find the line:
```ts
getModel(): ModelName {
  return this.model.getResolvedModel();
}
```
Replace with:
```ts
getModel(): ModelName {
  return this.model.getModel();
}
```

Search for any other `.getResolvedModel()` call inside `lib/clients/*.ts` and replace each with `.getModel()`. (There should only be the one per file.)

- [ ] **Step 5.3: Update `lib/model.test.ts` if needed**

```bash
grep -n "getResolvedModel\|resolveModel" lib/model.test.ts
```

If matches appear, update them to call `getModel()` instead. If no matches, no change needed.

- [ ] **Step 5.4: Verify**

```bash
pnpm typecheck
pnpm test
```

- [ ] **Step 5.5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
simplify Model class

Drop the model/resolvedModel split and getResolvedModel(). With strategies
gone, model is always a known ModelName string at construction time.
EOF
)"
```

---

## Task 6: Version bump and documentation

**Files:**
- Modify: `package.json` (version `0.0.67` → `0.1.0`)
- Modify: `README.md` (drop strategy framing/examples; merge config tables; delete Middleware section)
- Modify: `CLAUDE.md` (verify and update any stale references)
- Modify: `TODO.md` (delete strategy/ModelConfig items)
- Regenerate: `docs/` (TypeDoc output via `pnpm doc`)

- [ ] **Step 6.1: Bump version**

In `package.json`, change:
```json
"version": "0.0.67",
```
to:
```json
"version": "0.1.0",
```

- [ ] **Step 6.2: Update `README.md`**

Apply the following edits to `README.md`:

1. **Replace line 3** (current intro):
   ```
   Smoltalk exposes a common API to different LLM providers. There are other packages that do this, but Smoltalk allows you to build strategies on top of it. Here is a simple example.
   ```
   With:
   ```
   Smoltalk exposes a common API to different LLM providers, with built-in cost tracking, structured output, tool calling, streaming, and observability hooks. Here is a simple example.
   ```

2. **Delete lines 57–86** (the entire `fallback` / `race` / combined-strategies block that starts with "What if you wanted to have fallbacks..." and ends with "You get the idea."). Replace with a single blank line.

3. **Delete lines 217–298** (the entire `## Middleware` section, from the `## Middleware` header through the end of the "Cost tracking" subsection — i.e., up to but not including the `## Limitations` header).

4. **Replace lines 161–193** (the `## Configuration Options` section through the end of the request-options table) with a single unified configuration block:

   ```markdown
   ## Configuration Options

   `SmolConfig` is a single config type passed to `text()`. It contains everything: API keys, model selection, request parameters, hooks, and observability options.

   | Option | Type | Description |
   |--------|------|-------------|
   | `model` | `ModelName` | **Required.** The model to use (e.g. `"gpt-4o"`, `"gemini-2.0-flash-lite"`). |
   | `messages` | `Message[]` | **Required.** The conversation messages to send. |
   | `openAiApiKey` | `string` | OpenAI API key. |
   | `googleApiKey` | `string` | Google Gemini API key. |
   | `anthropicApiKey` | `string` | Anthropic API key. |
   | `ollamaApiKey` | `string` | Ollama API key (only needed for cloud Ollama). |
   | `ollamaHost` | `string` | Ollama host URL (for self-hosted or cloud Ollama). |
   | `llamaCppModelDir` | `string` | Directory path for Llama.cpp models. |
   | `provider` | `Provider` | Override provider detection. One of `"openai"`, `"openai-responses"`, `"google"`, `"ollama"`, `"anthropic"`, `"llama-cpp"`. |
   | `logLevel` | `LogLevel` | Logging verbosity: `"debug"`, `"info"`, `"warn"`, `"error"`. |
   | `tools` | `{ name, description?, schema }[]` | Tool definitions. `schema` is a Zod object schema. |
   | `responseFormat` | `ZodType` | Zod schema for structured output. The response is parsed and validated against this schema. |
   | `responseFormatOptions` | `object` | Fine-grained control over structured output (see below). |
   | `maxTokens` | `number` | Maximum number of output tokens to generate. |
   | `temperature` | `number` | Sampling temperature (0–2). |
   | `numSuggestions` | `number` | Number of completions to generate. |
   | `parallelToolCalls` | `boolean` | Whether to allow the model to call multiple tools in parallel. |
   | `stream` | `boolean` | If `true`, returns an `AsyncGenerator<StreamChunk>` instead of a `Promise`. |
   | `thinking` | `{ enabled, budgetTokens? }` | Enable extended thinking / thought signatures (Anthropic and Google). |
   | `reasoningEffort` | `"low" \| "medium" \| "high"` | Provider-agnostic reasoning effort level. |
   | `maxMessages` | `number` | If the message list exceeds this count, returns a failure instead of calling the API. |
   | `abortSignal` | `AbortSignal` | Cancel an in-flight request. |
   | `toolLoopDetection` | `ToolLoopDetection` | Detect and break tool-call loops. See below. |
   | `rawAttributes` | `Record<string, any>` | Pass provider-specific attributes directly to the API request. |
   | `hooks` | `{ onStart?, onToolCall?, onEnd?, onError? }` | Lifecycle hooks. |
   | `statelog` | `object` | Configuration for Statelog observability/tracing integration. |
   | `metadata` | `Record<string, any>` | Arbitrary metadata. |
   ```

5. **In the `toolLoopDetection` table** further down (around line 213), change `maxConsecutive` to `maxCalls` to match the actual type. (Verify the current property name in `lib/types.ts:ToolLoopDetection` after Task 4.)

- [ ] **Step 6.3: Update `CLAUDE.md`**

Open `CLAUDE.md` and search for any of the following strings:
- `strategies/`
- `middleware`
- `latencyTracker`
- `SmolPromptConfig`
- `PromptConfig` (as a separate type from `SmolConfig`)
- `splitConfig`
- `ResolvedSmolConfig`

For each match: remove or rewrite the surrounding sentence to reflect the unified `SmolConfig` and the absence of strategies/middleware. The "SmolClient interface" bullet (around the architecture section) should describe methods as taking `SmolConfig`.

If no matches are found, leave the file alone.

- [ ] **Step 6.4: Update `TODO.md`**

Open `TODO.md`. Delete:
- The line `- todo: add ability to use a model config as a strategy`
- The two-line paragraph starting `Does it make sense to get rid of the ModelConfig idea?` and ending `which means modelconfig needs to be parsable as a strategy.`

Keep all other lines.

- [ ] **Step 6.5: Regenerate API docs**

```bash
pnpm doc
```

This regenerates `docs/` (TypeDoc HTML output) and runs prettier on it.

- [ ] **Step 6.6: Final verification**

```bash
pnpm typecheck
pnpm test
pnpm build
```

All three must pass. `pnpm build` is the final smoke test that the published package compiles cleanly.

- [ ] **Step 6.7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
bump to 0.1.0; update docs

Bump package to 0.1.0 to mark the cleanup as a breaking change. Update
README to drop strategy/middleware sections and unify the config table.
Trim TODO.md and regenerate TypeDoc output.
EOF
)"
```

---

## Done

After Task 6, the repo is at `0.1.0` with:
- No strategies, no middleware, no latency tracker
- One unified `SmolConfig` type
- Simpler `Model` class
- Updated README, CLAUDE.md, TODO.md, and TypeDoc output

The follow-up plugin-API + llama-cpp extraction project is **out of scope** here and gets its own spec/plan.
