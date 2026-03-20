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

## Execution Flow

### "before" timing

1. Run middleware checks (parallel or sequential per `mode`).
2. If any check blocks, return a `PromptResult` with the replacement output from `decide()`.
3. If all pass, run the main prompt normally.

### "parallel" timing

1. Start middleware checks AND the main prompt simultaneously.
2. Create an `AbortController` for the main prompt.
3. If a middleware check blocks before the main prompt finishes, abort the main prompt via `AbortSignal` and return the replacement `PromptResult`.
4. If all middleware checks pass, await the main prompt result and return it.
5. If the main prompt finishes first, still wait for middleware checks to complete before returning.

### Sequential mode

Run checks in array order. On first block, stop — don't run remaining checks.

### Parallel mode

Run all checks concurrently. If multiple block, use the first one in array order (deterministic priority).

## How Middleware Calls Are Dispatched

Middleware calls are regular Smoltalk calls via `textSync()` from `functions.ts`. For each check, a new `SmolPromptConfig` is built by:

- **Keeping**: model, strategy, API keys, hooks, timeout, fallbacks — the full strategy config from the parent call.
- **Replacing**: `messages` (check's messages + original messages appended), `responseFormat`, `responseFormatOptions`.
- **Removing**: `middleware` (set to `undefined` to prevent recursive middleware).

This means middleware inherits the user's strategy. If the user has `timeout(fallback(claude, gemini))`, each middleware check runs through the same pipeline.

## Blocked PromptResult Shape

```typescript
{
  output: "Blocked: contains prompt injection attempt",  // string returned by decide()
  toolCalls: [],
  // usage/cost from the middleware call(s), not the main prompt
}
```

## Streaming

- **"before" timing**: Middleware runs first (sync), then stream starts normally.
- **"parallel" timing**: Chunks are buffered internally until middleware checks complete. If checks pass, buffered chunks are yielded followed by live streaming. If checks block, a single `done` chunk with the replacement output is yielded instead.

## Abort Wiring (Parallel Timing)

```typescript
const abortController = new AbortController();
const mainPromise = textSync({
  ...config,
  middleware: undefined,
  abortSignal: abortController.signal,
});
const middlewareResult = await runMiddlewareChecks(config);
if (middlewareResult.blocked) {
  abortController.abort();
  return middlewareResult.promptResult;
}
return await mainPromise;
```

If the parent config already has an `abortSignal`, it is linked so external cancellation propagates to both the main prompt and middleware calls.

## Error Handling

### Middleware LLM call fails

Treated as a block. Returns a `PromptResult` with output: `"Middleware check failed: <error message>"`. Rationale: middleware is a safety gate — if we can't verify, we block.

### `decide()` throws

Same behavior — wrapped in try/catch, treated as a block with the error message as output.

### Recursive middleware prevention

Middleware calls are dispatched with `middleware: undefined`. Middleware never triggers its own middleware.

## Hooks Interaction

Middleware calls are regular Smoltalk calls, so all `SmolConfig.hooks` (`onStart`, `onEnd`, `onToolCall`, `onError`, `onStrategyStart`) fire for middleware calls. This gives users observability into middleware execution for free.

## Files to Create/Modify

- **New**: `lib/middleware.ts` — `MiddlewareConfig`, `MiddlewareCheck` types, `runMiddleware()` execution logic.
- **Modify**: `lib/types.ts` — add `middleware?: MiddlewareConfig` to `SmolConfig`.
- **Modify**: `lib/functions.ts` — `text()`, `textSync()`, `textStream()` call `runMiddleware()` before/alongside the strategy.
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
