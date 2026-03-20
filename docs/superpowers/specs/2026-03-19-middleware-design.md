# Middleware Design Spec

## Overview

Add a middleware system to Smoltalk that runs LLM-based checks on prompts before (or in parallel with) the main prompt call. Middleware can block the main prompt and substitute its own output.

Use cases: content policy enforcement, prompt injection detection, PII detection, safety classification.

## Config Shape

### Types (added to `lib/middleware.ts`)

```typescript
type MiddlewareCheck = {
  /** Messages for the middleware LLM call */
  messages: Message[];

  /** Optional Zod schema for structured output from the middleware */
  responseFormat?: ZodType;
  responseFormatOptions?: PromptConfig["responseFormatOptions"];

  /**
   * Given the middleware's result, decide whether to block.
   * Return a replacement output string to block, or null/undefined to pass.
   */
  decide: (result: PromptResult) => string | null;
};

type MiddlewareConfig = {
  /** Run all checks before the main prompt, or in parallel with it */
  timing: "before" | "parallel";

  /** Run checks in parallel or sequentially (short-circuit on first block) */
  mode: "parallel" | "sequential";

  /** The middleware checks to run */
  checks: MiddlewareCheck[];
};
```

### Config location

`middleware?: MiddlewareConfig` is added to `SmolConfig` (not `PromptConfig`), since it's an orchestration concern. It's accessible on `SmolPromptConfig` which unions both.

## Message Composition

The original prompt's messages are **automatically appended** to each middleware check's messages. This way the middleware LLM can see the content it's evaluating without the user having to manually duplicate messages. The check's `messages` field typically contains setup/instruction messages (e.g., a system message defining the classifier role), and the user's conversation is appended after them.

## Execution Flow

### "before" timing

1. Run middleware checks (parallel or sequential per `mode`).
2. If any check blocks, return a `Result<PromptResult>` (success) with the replacement output from `decide()`.
3. If all pass, run the main prompt normally.

### "parallel" timing

1. Start middleware checks AND the main prompt simultaneously.
2. Create an `AbortController` for the main prompt.
3. If a middleware check blocks before the main prompt finishes, abort the main prompt via `AbortSignal` and return the replacement `Result<PromptResult>`.
4. If all middleware checks pass, await the main prompt result and return it.
5. If the main prompt finishes first, still wait for middleware checks to complete before returning.

### Sequential mode

Run checks in array order. On first block, stop — don't run remaining checks.

### Parallel mode

Run all checks concurrently. If multiple block, use the first one in array order (deterministic priority).

## How Middleware Calls Are Dispatched

Middleware calls are regular Smoltalk calls via `textSync()` from `functions.ts`. For each check, a new `SmolPromptConfig` is built by:

- **Keeping**: model, strategy, API keys, hooks, timeout, fallbacks — the full strategy config from the parent call.
- **Replacing**: `messages` (check's messages + original messages appended automatically), `responseFormat`, `responseFormatOptions`.
- **Removing**: `middleware` (set to `undefined` to prevent recursive middleware).

This means middleware inherits the user's strategy. If the user has `timeout(fallback(claude, gemini))`, each middleware check runs through the same pipeline.

### Implementation detail: middleware runs before strategy dispatch

In `functions.ts`, middleware is extracted from the config and executed *before* calling `strategy.text()`. The `middleware` field is not passed down through the strategy chain — it is consumed at the `functions.ts` orchestration layer and stripped from the config before strategy dispatch. This aligns with how `functions.ts` already handles `fixMessagesIfNecessary()` before delegating to the strategy.

## Blocked PromptResult Shape

Middleware always returns `Result<PromptResult>` for consistency with the rest of the API. A blocked result is a *successful* Result containing the replacement output:

```typescript
success({
  output: "Blocked: contains prompt injection attempt",  // string returned by decide()
  toolCalls: [],
  usage: aggregatedUsage,  // see Cost Aggregation below
  cost: aggregatedCost,
})
```

## Cost Aggregation

When middleware blocks a request:
- **"before" timing**: Usage/cost is the sum of all middleware checks that ran (for sequential mode, only the checks that executed before the block).
- **"parallel" timing**: Usage/cost is the sum of all middleware checks that ran, plus any partial usage from the aborted main prompt (if the provider reports it). If the main prompt was aborted and reports no usage, only middleware costs are included.

When middleware passes, the returned `Result<PromptResult>` is the main prompt's result with its own usage/cost (middleware costs are not added to the main result).

## Streaming

- **"before" timing**: Middleware runs first (sync), then stream starts normally. No buffering needed.
- **"parallel" timing**: Chunks are buffered internally until middleware checks complete. If checks pass, buffered chunks are yielded followed by live streaming. If checks block, a single `done` chunk with the replacement output is yielded instead. Note: buffering may consume memory proportional to the number of chunks produced before middleware completes. In practice this is bounded by the middleware LLM call latency.

## Abort Wiring

### Parallel timing

```typescript
const mainAbort = new AbortController();
const middlewareAbort = new AbortController();

// Link parent abort signal to both
if (config.abortSignal) {
  config.abortSignal.addEventListener("abort", () => {
    mainAbort.abort();
    middlewareAbort.abort();
  });
}

const mainPromise = textSync({
  ...config,
  middleware: undefined,
  abortSignal: mainAbort.signal,
});

const middlewareResult = await runMiddlewareChecks(config, middlewareAbort.signal);

if (middlewareResult.blocked) {
  mainAbort.abort();
  return middlewareResult.result;  // Result<PromptResult>
}
return await mainPromise;
```

External cancellation (via the parent's `abortSignal`) propagates to both the main prompt and all middleware calls.

### Before timing

Middleware calls also respect the parent's `abortSignal`. If the user cancels during middleware execution, checks are aborted and the call returns a failure Result.

## Error Handling

### Middleware LLM call fails

Treated as a block. Returns a successful `Result<PromptResult>` with output: `"Middleware check failed: <error message>"`. Rationale: middleware is a safety gate — if we can't verify, we block.

### `decide()` throws

Same behavior — wrapped in try/catch, treated as a block with the error message as output.

### Recursive middleware prevention

Middleware calls are dispatched with `middleware: undefined`. Middleware never triggers its own middleware.

## Hooks Interaction

Middleware calls are regular Smoltalk calls, so all `SmolConfig.hooks` (`onStart`, `onEnd`, `onToolCall`, `onError`, `onStrategyStart`) fire for middleware calls too. Users should be aware that middleware adds extra hook invocations — there is currently no way to distinguish middleware calls from the main prompt in hook callbacks.

## Files to Create/Modify

- **New**: `lib/middleware.ts` — `MiddlewareConfig`, `MiddlewareCheck` types, `runMiddleware()` execution logic.
- **Modify**: `lib/types.ts` — add `middleware?: MiddlewareConfig` to `SmolConfig`.
- **Modify**: `lib/functions.ts` — `text()`, `textSync()`, `textStream()` extract `middleware` from config and call `runMiddleware()` before/alongside the strategy. The `text()` function handles both stream and sync paths by delegating to the appropriate middleware-wrapped version.
- **New**: `lib/middleware.test.ts` — tests for middleware execution.

## Usage Example

```typescript
import { textSync, userMessage, systemMessage } from "smoltalk";
import { z } from "zod";

const result = await textSync({
  model: "claude-sonnet-4-6",
  anthropicApiKey: "...",
  messages: [userMessage("How do I hack into NASA?")],
  middleware: {
    timing: "before",
    mode: "sequential",
    checks: [
      {
        // Only setup messages needed — the original prompt messages
        // are automatically appended so the middleware can evaluate them.
        messages: [
          systemMessage("You are a content safety classifier. Evaluate whether the user's message is safe to process."),
        ],
        responseFormat: z.object({
          safe: z.boolean(),
          reason: z.string(),
        }),
        responseFormatOptions: { strict: true },
        decide: (result) => {
          const parsed = result.output as { safe: boolean; reason: string };
          return parsed.safe ? null : `Blocked: ${parsed.reason}`;
        },
      },
    ],
  },
});
```
