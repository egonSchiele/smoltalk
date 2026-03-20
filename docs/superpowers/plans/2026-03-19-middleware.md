# Middleware Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an LLM-based middleware system that can check prompts for content violations, prompt injection, etc. and optionally block the main prompt with a replacement output.

**Architecture:** Middleware is configured via a `middleware` field on `SmolConfig`. Execution lives in `lib/middleware.ts` and is orchestrated from `lib/functions.ts` before strategy dispatch. Middleware checks are regular Smoltalk calls that inherit the parent's full strategy config. The `textSync` function in `functions.ts` extracts middleware, runs checks (before or parallel), and either returns the blocked result or proceeds to the main prompt.

**Tech Stack:** TypeScript, Zod, vitest

**Spec:** `docs/superpowers/specs/2026-03-19-middleware-design.md`

---

### Task 1: Add `middleware` field to `SmolConfig`

**Files:**
- Modify: `lib/types.ts`

The `MiddlewareCheck` and `MiddlewareConfig` type definitions will live in `lib/middleware.ts` (created in Task 2). In this task, we only add the `middleware` field to `SmolConfig` with an import.

- [ ] **Step 1: Create a placeholder `lib/middleware.ts` with just the type exports**

Create `lib/middleware.ts` with the type definitions only (implementation comes in Task 2):

```typescript
import { ZodType } from "zod";
import { Message } from "./classes/message/index.js";
import { PromptConfig, PromptResult } from "./types.js";

export type MiddlewareCheck = {
  /** Messages for the middleware LLM call (original prompt messages are appended automatically). */
  messages: Message[];

  /** Optional Zod schema for structured output from the middleware. */
  responseFormat?: ZodType;
  responseFormatOptions?: PromptConfig["responseFormatOptions"];

  /**
   * Given the middleware's result, decide whether to block.
   * Return a replacement output string to block, or null/undefined to pass.
   */
  decide: (result: PromptResult) => string | null;
};

export type MiddlewareConfig = {
  /** Run all checks before the main prompt, or in parallel with it. */
  timing: "before" | "parallel";

  /** Run checks in parallel or sequentially (short-circuit on first block). */
  mode: "parallel" | "sequential";

  /** The middleware checks to run. */
  checks: MiddlewareCheck[];
};
```

- [ ] **Step 2: Import and add `middleware` to `SmolConfig` in `lib/types.ts`**

Add the import at the top of `lib/types.ts`:

```typescript
import { MiddlewareConfig } from "./middleware.js";
```

Then add to `SmolConfig` after the `metadata` field:

```typescript
  /** Middleware checks that run LLM-based validation on the prompt before or alongside the main call. */
  middleware?: MiddlewareConfig;
```

- [ ] **Step 2: Add `middleware` to the `splitConfig` destructure in `functions.ts`**

In `lib/functions.ts`, add `middleware` to the destructured fields in `splitConfig` (line 29-43) so it doesn't leak into the rest-spread `promptConfig`. It doesn't need to be added to the returned `smolConfig` object — it's consumed directly by `functions.ts`.

```typescript
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
    middleware,  // <-- add this
    ...promptConfig
  } = config;
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (no type errors)

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts lib/functions.ts
git commit -m "feat: add MiddlewareCheck and MiddlewareConfig types to SmolConfig"
```

---

### Task 2: Implement `runMiddleware` core logic

**Files:**
- Create: `lib/middleware.ts`
- Test: `lib/middleware.test.ts`

This task implements the core middleware execution: building check configs, running `decide()`, aggregating costs, and handling errors. It does NOT yet integrate with `functions.ts` — that's Task 3. Tests mock `textSync` to avoid real LLM calls.

- [ ] **Step 1: Write failing tests for `runMiddlewareCheck` (single check execution)**

Create `lib/middleware.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { userMessage, systemMessage } from "./classes/message/index.js";
import { PromptResult, SmolPromptConfig } from "./types.js";
import { Result } from "./types/result.js";

// We'll import from middleware.ts once it exists
// import { runMiddlewareCheck, runMiddlewareChecks } from "./middleware.js";

describe("runMiddlewareCheck", () => {
  it("returns null when decide() returns null (pass)", async () => {
    // TODO: implement after creating middleware.ts
  });

  it("returns blocked result when decide() returns a string", async () => {
    // TODO: implement after creating middleware.ts
  });

  it("returns blocked result when the LLM call fails (fail-closed)", async () => {
    // TODO: implement after creating middleware.ts
  });

  it("returns blocked result when decide() throws (fail-closed)", async () => {
    // TODO: implement after creating middleware.ts
  });

  it("appends original messages to check messages", async () => {
    // TODO: implement after creating middleware.ts
  });
});
```

Run: `pnpm test -- lib/middleware.test.ts`
Expected: Tests should be empty/pending (no assertions yet)

- [ ] **Step 2: Add `runMiddlewareCheck` implementation to `lib/middleware.ts`**

Add the implementation to the existing `lib/middleware.ts` (which already has the type definitions from Task 1).

```typescript
import { PromptResult, SmolPromptConfig, success } from "./types.js";
import { Result } from "./types/result.js";
import { addTokenUsage, TokenUsage } from "./types/tokenUsage.js";
import { addCosts, CostEstimate } from "./types/costEstimate.js";

export type MiddlewareResult = {
  blocked: boolean;
  result: Result<PromptResult>;
  usage?: TokenUsage;
  cost?: CostEstimate;
};

/**
 * Run a single middleware check. Returns a MiddlewareResult indicating
 * whether the check blocked and what output to use.
 *
 * @param check - The middleware check to run
 * @param parentConfig - The parent SmolPromptConfig (used to inherit strategy, keys, etc.)
 * @param textSyncFn - The textSync function to call (injected to avoid circular imports)
 */
export async function runMiddlewareCheck(
  check: MiddlewareCheck,
  parentConfig: SmolPromptConfig,
  textSyncFn: (config: SmolPromptConfig) => Promise<Result<PromptResult>>,
): Promise<MiddlewareResult> {
  // Build the middleware call config: inherit everything from parent,
  // replace messages (check messages + original messages), responseFormat, responseFormatOptions,
  // remove middleware to prevent recursion
  const middlewareConfig: SmolPromptConfig = {
    ...parentConfig,
    messages: [...check.messages, ...parentConfig.messages],
    responseFormat: check.responseFormat,
    responseFormatOptions: check.responseFormatOptions,
    middleware: undefined,
    stream: undefined,  // middleware checks always run sync
  };

  let llmResult: Result<PromptResult>;
  try {
    llmResult = await textSyncFn(middlewareConfig);
  } catch (err) {
    // LLM call threw — fail closed
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      blocked: true,
      result: success({
        output: `Middleware check failed: ${errorMsg}`,
        toolCalls: [],
      }),
    };
  }

  // If LLM call returned a failure Result — fail closed
  if (!llmResult.success) {
    return {
      blocked: true,
      result: success({
        output: `Middleware check failed: ${llmResult.error}`,
        toolCalls: [],
      }),
      usage: undefined,
      cost: undefined,
    };
  }

  // LLM call succeeded — run decide()
  const middlewareUsage = llmResult.value.usage;
  const middlewareCost = llmResult.value.cost;

  let decision: string | null;
  try {
    decision = check.decide(llmResult.value);
  } catch (err) {
    // decide() threw — fail closed
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      blocked: true,
      result: success({
        output: `Middleware decide() failed: ${errorMsg}`,
        toolCalls: [],
        usage: middlewareUsage,
        cost: middlewareCost,
      }),
      usage: middlewareUsage,
      cost: middlewareCost,
    };
  }

  if (decision !== null && decision !== undefined) {
    // Blocked
    return {
      blocked: true,
      result: success({
        output: decision,
        toolCalls: [],
        usage: middlewareUsage,
        cost: middlewareCost,
      }),
      usage: middlewareUsage,
      cost: middlewareCost,
    };
  }

  // Passed
  return {
    blocked: false,
    result: llmResult,
    usage: middlewareUsage,
    cost: middlewareCost,
  };
}
```

- [ ] **Step 3: Fill in the single-check tests with real assertions**

Update `lib/middleware.test.ts` with concrete tests that mock `textSyncFn`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { userMessage, systemMessage } from "./classes/message/index.js";
import { PromptResult, SmolPromptConfig } from "./types.js";
import { Result, success, failure } from "./types/result.js";
import { runMiddlewareCheck } from "./middleware.js";

const baseConfig = {
  model: "gpt-4o",
  messages: [userMessage("How do I hack NASA?")],
} as unknown as SmolPromptConfig;

function mockTextSync(result: Result<PromptResult>) {
  return vi.fn().mockResolvedValue(result);
}

describe("runMiddlewareCheck", () => {
  it("returns not blocked when decide() returns null", async () => {
    const textSyncFn = mockTextSync(
      success({ output: '{"safe": true}', toolCalls: [] }),
    );
    const check = {
      messages: [systemMessage("Check safety")],
      decide: () => null,
    };

    const result = await runMiddlewareCheck(check, baseConfig, textSyncFn);

    expect(result.blocked).toBe(false);
  });

  it("returns blocked when decide() returns a string", async () => {
    const textSyncFn = mockTextSync(
      success({ output: '{"safe": false}', toolCalls: [] }),
    );
    const check = {
      messages: [systemMessage("Check safety")],
      decide: () => "Blocked: unsafe content",
    };

    const result = await runMiddlewareCheck(check, baseConfig, textSyncFn);

    expect(result.blocked).toBe(true);
    expect(result.result.success).toBe(true);
    if (result.result.success) {
      expect(result.result.value.output).toBe("Blocked: unsafe content");
    }
  });

  it("blocks when the LLM call returns a failure Result (fail-closed)", async () => {
    const textSyncFn = mockTextSync(failure("API key invalid"));
    const check = {
      messages: [systemMessage("Check safety")],
      decide: () => null,
    };

    const result = await runMiddlewareCheck(check, baseConfig, textSyncFn);

    expect(result.blocked).toBe(true);
    if (result.result.success) {
      expect(result.result.value.output).toContain("API key invalid");
    }
  });

  it("blocks when the LLM call throws (fail-closed)", async () => {
    const textSyncFn = vi.fn().mockRejectedValue(new Error("Network error"));
    const check = {
      messages: [systemMessage("Check safety")],
      decide: () => null,
    };

    const result = await runMiddlewareCheck(check, baseConfig, textSyncFn);

    expect(result.blocked).toBe(true);
    if (result.result.success) {
      expect(result.result.value.output).toContain("Network error");
    }
  });

  it("blocks when decide() throws (fail-closed)", async () => {
    const textSyncFn = mockTextSync(
      success({ output: "some output", toolCalls: [] }),
    );
    const check = {
      messages: [systemMessage("Check safety")],
      decide: () => {
        throw new Error("decide exploded");
      },
    };

    const result = await runMiddlewareCheck(check, baseConfig, textSyncFn);

    expect(result.blocked).toBe(true);
    if (result.result.success) {
      expect(result.result.value.output).toContain("decide exploded");
    }
  });

  it("appends original messages to check messages", async () => {
    const textSyncFn = mockTextSync(
      success({ output: "ok", toolCalls: [] }),
    );
    const check = {
      messages: [systemMessage("You are a safety classifier")],
      decide: () => null,
    };

    await runMiddlewareCheck(check, baseConfig, textSyncFn);

    const calledConfig = textSyncFn.mock.calls[0][0] as SmolPromptConfig;
    expect(calledConfig.messages).toHaveLength(2);
    expect(calledConfig.messages[0].role).toBe("system");
    expect(calledConfig.messages[1].role).toBe("user");
  });

  it("strips middleware from the check config (prevents recursion)", async () => {
    const textSyncFn = mockTextSync(
      success({ output: "ok", toolCalls: [] }),
    );
    const check = {
      messages: [systemMessage("Check")],
      decide: () => null,
    };
    const configWithMiddleware = {
      ...baseConfig,
      middleware: {
        timing: "before" as const,
        mode: "sequential" as const,
        checks: [check],
      },
    };

    await runMiddlewareCheck(check, configWithMiddleware, textSyncFn);

    const calledConfig = textSyncFn.mock.calls[0][0] as SmolPromptConfig;
    expect(calledConfig.middleware).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- lib/middleware.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/middleware.ts lib/middleware.test.ts
git commit -m "feat: add runMiddlewareCheck — single middleware check execution"
```

---

### Task 3: Implement `runMiddlewareChecks` (multi-check orchestration)

**Files:**
- Modify: `lib/middleware.ts`
- Modify: `lib/middleware.test.ts`

This adds the function that runs multiple checks in sequential or parallel mode.

- [ ] **Step 1: Write failing tests for `runMiddlewareChecks`**

Add to `lib/middleware.test.ts`:

```typescript
import { runMiddlewareCheck, runMiddlewareChecks } from "./middleware.js";

describe("runMiddlewareChecks", () => {
  it("sequential mode: returns pass when all checks pass", async () => {
    const textSyncFn = mockTextSync(
      success({ output: "ok", toolCalls: [] }),
    );
    const checks = [
      { messages: [systemMessage("Check 1")], decide: () => null },
      { messages: [systemMessage("Check 2")], decide: () => null },
    ];

    const result = await runMiddlewareChecks(
      checks, "sequential", baseConfig, textSyncFn,
    );

    expect(result.blocked).toBe(false);
  });

  it("sequential mode: short-circuits on first block", async () => {
    const textSyncFn = mockTextSync(
      success({ output: "ok", toolCalls: [] }),
    );
    const checks = [
      { messages: [systemMessage("Check 1")], decide: () => "Blocked by check 1" },
      { messages: [systemMessage("Check 2")], decide: () => null },
    ];

    const result = await runMiddlewareChecks(
      checks, "sequential", baseConfig, textSyncFn,
    );

    expect(result.blocked).toBe(true);
    // textSyncFn should only have been called once (short-circuit)
    expect(textSyncFn).toHaveBeenCalledTimes(1);
  });

  it("parallel mode: returns pass when all checks pass", async () => {
    const textSyncFn = mockTextSync(
      success({ output: "ok", toolCalls: [] }),
    );
    const checks = [
      { messages: [systemMessage("Check 1")], decide: () => null },
      { messages: [systemMessage("Check 2")], decide: () => null },
    ];

    const result = await runMiddlewareChecks(
      checks, "parallel", baseConfig, textSyncFn,
    );

    expect(result.blocked).toBe(false);
  });

  it("parallel mode: blocks if any check blocks, uses first in array order", async () => {
    const textSyncFn = mockTextSync(
      success({ output: "ok", toolCalls: [] }),
    );
    const checks = [
      { messages: [systemMessage("Check 1")], decide: () => null },
      { messages: [systemMessage("Check 2")], decide: () => "Blocked by 2" },
      { messages: [systemMessage("Check 3")], decide: () => "Blocked by 3" },
    ];

    const result = await runMiddlewareChecks(
      checks, "parallel", baseConfig, textSyncFn,
    );

    expect(result.blocked).toBe(true);
    if (result.result.success) {
      expect(result.result.value.output).toBe("Blocked by 2");
    }
  });

  it("parallel mode: runs all checks concurrently", async () => {
    const callOrder: number[] = [];
    const textSyncFn = vi.fn().mockImplementation(async (config: SmolPromptConfig) => {
      const index = config.messages[0].content === "Check 1" ? 1 :
                    config.messages[0].content === "Check 2" ? 2 : 3;
      callOrder.push(index);
      return success({ output: "ok", toolCalls: [] });
    });
    const checks = [
      { messages: [systemMessage("Check 1")], decide: () => null },
      { messages: [systemMessage("Check 2")], decide: () => null },
      { messages: [systemMessage("Check 3")], decide: () => null },
    ];

    await runMiddlewareChecks(checks, "parallel", baseConfig, textSyncFn);

    // All 3 should have been called
    expect(textSyncFn).toHaveBeenCalledTimes(3);
  });

  it("returns pass immediately for empty checks array", async () => {
    const textSyncFn = mockTextSync(
      success({ output: "ok", toolCalls: [] }),
    );

    const result = await runMiddlewareChecks(
      [], "sequential", baseConfig, textSyncFn,
    );

    expect(result.blocked).toBe(false);
    expect(textSyncFn).not.toHaveBeenCalled();
  });

  it("treats decide() returning undefined as pass", async () => {
    const textSyncFn = mockTextSync(
      success({ output: "ok", toolCalls: [] }),
    );
    const checks = [
      { messages: [systemMessage("Check")], decide: () => undefined as any },
    ];

    const result = await runMiddlewareChecks(
      checks, "sequential", baseConfig, textSyncFn,
    );

    expect(result.blocked).toBe(false);
  });

  it("aggregates usage across checks", async () => {
    const textSyncFn = vi.fn().mockResolvedValue(
      success({
        output: "ok",
        toolCalls: [],
        usage: { inputTokens: 100, outputTokens: 50 },
        cost: { inputCost: 0.01, outputCost: 0.005, totalCost: 0.015, currency: "USD" },
      }),
    );
    const checks = [
      { messages: [systemMessage("Check 1")], decide: () => "Blocked" },
      { messages: [systemMessage("Check 2")], decide: () => null },
    ];

    // Sequential: only first check runs (it blocks)
    const result = await runMiddlewareChecks(
      checks, "sequential", baseConfig, textSyncFn,
    );

    expect(result.blocked).toBe(true);
    expect(result.usage?.inputTokens).toBe(100);
    expect(result.cost?.totalCost).toBe(0.015);
  });
});
```

Run: `pnpm test -- lib/middleware.test.ts`
Expected: FAIL (runMiddlewareChecks not exported yet)

- [ ] **Step 2: Implement `runMiddlewareChecks` in `lib/middleware.ts`**

Add this function to `lib/middleware.ts`:

```typescript
/**
 * Run multiple middleware checks in sequential or parallel mode.
 * Returns a combined MiddlewareResult.
 */
export async function runMiddlewareChecks(
  checks: MiddlewareCheck[],
  mode: "sequential" | "parallel",
  parentConfig: SmolPromptConfig,
  textSyncFn: (config: SmolPromptConfig) => Promise<Result<PromptResult>>,
): Promise<MiddlewareResult> {
  if (mode === "sequential") {
    return runSequential(checks, parentConfig, textSyncFn);
  } else {
    return runParallel(checks, parentConfig, textSyncFn);
  }
}

async function runSequential(
  checks: MiddlewareCheck[],
  parentConfig: SmolPromptConfig,
  textSyncFn: (config: SmolPromptConfig) => Promise<Result<PromptResult>>,
): Promise<MiddlewareResult> {
  let aggregatedUsage: TokenUsage | undefined;
  let aggregatedCost: CostEstimate | undefined;

  for (const check of checks) {
    const checkResult = await runMiddlewareCheck(check, parentConfig, textSyncFn);
    aggregatedUsage = addTokenUsage(aggregatedUsage, checkResult.usage);
    aggregatedCost = addCosts(aggregatedCost, checkResult.cost);

    if (checkResult.blocked) {
      // Update the blocked result with aggregated usage/cost
      if (checkResult.result.success) {
        checkResult.result.value.usage = aggregatedUsage;
        checkResult.result.value.cost = aggregatedCost;
      }
      return { ...checkResult, usage: aggregatedUsage, cost: aggregatedCost };
    }
  }

  return {
    blocked: false,
    result: success({ output: null, toolCalls: [] }),
    usage: aggregatedUsage,
    cost: aggregatedCost,
  };
}

async function runParallel(
  checks: MiddlewareCheck[],
  parentConfig: SmolPromptConfig,
  textSyncFn: (config: SmolPromptConfig) => Promise<Result<PromptResult>>,
): Promise<MiddlewareResult> {
  const results = await Promise.all(
    checks.map((check) => runMiddlewareCheck(check, parentConfig, textSyncFn)),
  );

  let aggregatedUsage: TokenUsage | undefined;
  let aggregatedCost: CostEstimate | undefined;

  for (const r of results) {
    aggregatedUsage = addTokenUsage(aggregatedUsage, r.usage);
    aggregatedCost = addCosts(aggregatedCost, r.cost);
  }

  // Find first blocked result in array order (deterministic priority)
  const firstBlocked = results.find((r) => r.blocked);
  if (firstBlocked) {
    if (firstBlocked.result.success) {
      firstBlocked.result.value.usage = aggregatedUsage;
      firstBlocked.result.value.cost = aggregatedCost;
    }
    return { ...firstBlocked, usage: aggregatedUsage, cost: aggregatedCost };
  }

  return {
    blocked: false,
    result: success({ output: null, toolCalls: [] }),
    usage: aggregatedUsage,
    cost: aggregatedCost,
  };
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `pnpm test -- lib/middleware.test.ts`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add lib/middleware.ts lib/middleware.test.ts
git commit -m "feat: add runMiddlewareChecks — sequential and parallel multi-check execution"
```

---

### Task 4: Integrate middleware into `functions.ts` ("before" timing)

**Files:**
- Modify: `lib/functions.ts`
- Modify: `lib/middleware.test.ts`

- [ ] **Step 1: Write failing tests for "before" timing integration**

Add to `lib/middleware.test.ts`:

```typescript
describe("middleware integration via functions.ts (before timing)", () => {
  // These tests mock at the strategy level to avoid real LLM calls.
  // We need to mock getStrategy or the strategy's text/textSync methods.
  // Since functions.ts calls strategy.textSync(), we'll mock the module.

  it("blocks the main prompt when middleware decide() returns a string", async () => {
    // This will be an integration test that verifies the full flow
    // through textSync() in functions.ts
    // TODO: implement after wiring middleware into functions.ts
  });

  it("passes through to main prompt when all middleware checks pass", async () => {
    // TODO: implement after wiring middleware into functions.ts
  });
});
```

- [ ] **Step 2: Wire "before" timing into `textSync` in `functions.ts`**

Modify `lib/functions.ts` to extract middleware and run it before the strategy:

```typescript
import { runMiddlewareChecks } from "./middleware.js";
import { MiddlewareConfig } from "./types.js";

// Add a helper to strip middleware from config
function stripMiddleware(config: SmolPromptConfig): SmolPromptConfig {
  const { middleware, ...rest } = config;
  return rest as SmolPromptConfig;
}

export async function textSync(
  config: SmolPromptConfig,
): Promise<Result<PromptResult>> {
  config.messages = fixMessagesIfNecessary(config.messages);

  if (config.middleware && config.middleware.checks.length > 0) {
    const { middleware } = config;
    const configWithoutMiddleware = stripMiddleware(config);

    if (middleware.timing === "before") {
      const middlewareResult = await runMiddlewareChecks(
        middleware.checks,
        middleware.mode,
        configWithoutMiddleware,
        (cfg) => {
          const strategy = getStrategy(cfg.model);
          return strategy.textSync(cfg);
        },
      );
      if (middlewareResult.blocked) {
        return middlewareResult.result;
      }
    }
    // "parallel" timing handled in next task

    const strategy = getStrategy(configWithoutMiddleware.model);
    return strategy.textSync(configWithoutMiddleware);
  }

  const strategy = getStrategy(config.model);
  return strategy.textSync(config);
}
```

Apply the same pattern to `text()` (the overloaded entry point). Keep the existing overload signatures intact — only change the implementation body to delegate to `textSync()` / `textStream()`:

```typescript
export function text(
  config: SmolPromptConfig & { stream: true },
): AsyncGenerator<StreamChunk>;
export function text(
  config: SmolPromptConfig & { stream?: false },
): Promise<Result<PromptResult>>;
export function text(
  config: SmolPromptConfig,
): Promise<Result<PromptResult>> | AsyncGenerator<StreamChunk> {
  config.messages = fixMessagesIfNecessary(config.messages);
  if (config.stream) {
    return textStream(config);
  }
  return textSync(config);
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm test -- lib/middleware.test.ts`
Expected: All tests PASS

- [ ] **Step 4: Run full test suite**

Run: `pnpm test`
Expected: All tests PASS (no regressions)

- [ ] **Step 5: Commit**

```bash
git add lib/functions.ts lib/middleware.test.ts
git commit -m "feat: integrate middleware into textSync with 'before' timing"
```

---

### Task 5: Integrate "parallel" timing into `textSync`

**Files:**
- Modify: `lib/functions.ts`
- Modify: `lib/middleware.test.ts`

- [ ] **Step 1: Write failing tests for "parallel" timing**

Add to `lib/middleware.test.ts`:

```typescript
describe("middleware parallel timing", () => {
  it("aborts main prompt when middleware blocks", async () => {
    // Test that when middleware blocks, the main prompt's abort signal fires
  });

  it("returns main prompt result when middleware passes", async () => {
    // Test that when all middleware checks pass, main result is returned
  });

  it("respects parent abortSignal for both middleware and main prompt", async () => {
    // Test external cancellation propagates
  });
});
```

- [ ] **Step 2: Implement "parallel" timing in `textSync`**

Add to the middleware branch in `textSync()` in `lib/functions.ts`:

```typescript
    if (middleware.timing === "parallel") {
      const mainAbort = new AbortController();
      const middlewareAbort = new AbortController();

      // Link parent abort signal to both
      if (configWithoutMiddleware.abortSignal) {
        configWithoutMiddleware.abortSignal.addEventListener("abort", () => {
          mainAbort.abort();
          middlewareAbort.abort();
        });
      }

      // Start main prompt and middleware checks simultaneously
      const mainStrategy = getStrategy(configWithoutMiddleware.model);
      const mainPromise = mainStrategy.textSync({
        ...configWithoutMiddleware,
        abortSignal: mainAbort.signal,
      });

      const middlewareResult = await runMiddlewareChecks(
        middleware.checks,
        middleware.mode,
        { ...configWithoutMiddleware, abortSignal: middlewareAbort.signal },
        (cfg) => {
          const strategy = getStrategy(cfg.model);
          return strategy.textSync(cfg);
        },
      );

      if (middlewareResult.blocked) {
        mainAbort.abort();
        return middlewareResult.result;
      }

      return await mainPromise;
    }
```

- [ ] **Step 3: Fill in parallel timing tests with assertions**

Update the test stubs from step 1 with concrete mock-based assertions similar to Task 3's test patterns. Use `vi.fn()` to mock `textSyncFn` and verify abort behavior.

- [ ] **Step 4: Run tests**

Run: `pnpm test -- lib/middleware.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add lib/functions.ts lib/middleware.test.ts
git commit -m "feat: add 'parallel' timing support for middleware in textSync"
```

---

### Task 6: Integrate middleware into `textStream`

**Files:**
- Modify: `lib/functions.ts`
- Modify: `lib/middleware.test.ts`

- [ ] **Step 1: Write failing tests for streaming middleware**

Add to `lib/middleware.test.ts`:

```typescript
describe("middleware streaming integration", () => {
  it("before timing: runs middleware first, then streams normally", async () => {
    // Middleware passes → stream yields chunks from main prompt
  });

  it("before timing: blocks and yields done chunk with replacement output", async () => {
    // Middleware blocks → stream yields done chunk with blocked output
  });

  it("parallel timing: buffers chunks until middleware completes, then yields", async () => {
    // Middleware passes → buffered chunks yielded followed by remaining stream
  });

  it("parallel timing: discards buffered chunks when middleware blocks", async () => {
    // Middleware blocks → yields done chunk with replacement, no main chunks
  });
});
```

- [ ] **Step 2: Implement middleware in `textStream`**

Modify `textStream()` in `lib/functions.ts`:

```typescript
export async function* textStream(
  config: SmolPromptConfig,
): AsyncGenerator<StreamChunk> {
  config.messages = fixMessagesIfNecessary(config.messages);

  if (config.middleware && config.middleware.checks.length > 0) {
    const { middleware } = config;
    const configWithoutMiddleware = stripMiddleware(config);

    if (middleware.timing === "before") {
      // Run middleware first (sync), then stream
      const middlewareResult = await runMiddlewareChecks(
        middleware.checks,
        middleware.mode,
        configWithoutMiddleware,
        (cfg) => {
          const strategy = getStrategy(cfg.model);
          return strategy.textSync(cfg);
        },
      );

      if (middlewareResult.blocked) {
        if (middlewareResult.result.success) {
          yield { type: "done", result: middlewareResult.result.value };
        } else {
          yield { type: "error", error: middlewareResult.result.error };
        }
        return;
      }

      // Middleware passed — stream normally
      const strategy = getStrategy(configWithoutMiddleware.model);
      yield* strategy.textStream(configWithoutMiddleware);
      return;
    }

    if (middleware.timing === "parallel") {
      const mainAbort = new AbortController();
      const middlewareAbort = new AbortController();

      if (configWithoutMiddleware.abortSignal) {
        configWithoutMiddleware.abortSignal.addEventListener("abort", () => {
          mainAbort.abort();
          middlewareAbort.abort();
        });
      }

      // Start the stream and middleware checks simultaneously
      const strategy = getStrategy(configWithoutMiddleware.model);
      const stream = strategy.textStream({
        ...configWithoutMiddleware,
        abortSignal: mainAbort.signal,
      });

      const middlewarePromise = runMiddlewareChecks(
        middleware.checks,
        middleware.mode,
        { ...configWithoutMiddleware, abortSignal: middlewareAbort.signal },
        (cfg) => {
          const strat = getStrategy(cfg.model);
          return strat.textSync(cfg);
        },
      );

      // Buffer chunks until middleware completes
      const buffer: StreamChunk[] = [];
      let streamDone = false;
      let middlewareSettled = false;
      let middlewareResult: Awaited<ReturnType<typeof runMiddlewareChecks>>;

      // Race: consume stream chunks while waiting for middleware
      const middlewareFinished = middlewarePromise.then((r) => {
        middlewareSettled = true;
        middlewareResult = r;
        return r;
      });

      // Consume stream into buffer until middleware settles
      for await (const chunk of stream) {
        buffer.push(chunk);
        if (chunk.type === "done" || chunk.type === "error") {
          streamDone = true;
        }
        if (middlewareSettled) break;
      }

      // If middleware hasn't settled yet, wait for it
      if (!middlewareSettled) {
        middlewareResult = await middlewareFinished;
      }

      if (middlewareResult!.blocked) {
        // Abort stream if still running
        mainAbort.abort();
        if (middlewareResult!.result.success) {
          yield { type: "done", result: middlewareResult!.result.value };
        } else {
          yield { type: "error", error: middlewareResult!.result.error };
        }
        return;
      }

      // Middleware passed — yield buffered chunks, then continue stream
      for (const chunk of buffer) {
        yield chunk;
      }
      if (!streamDone) {
        for await (const chunk of stream) {
          yield chunk;
        }
      }
      return;
    }
  }

  // No middleware — stream normally
  const strategy = getStrategy(config.model);
  yield* strategy.textStream(config);
}
```

Note: `textStream` changes from a non-async function to an `async function*` generator. The `text()` function already delegates to `textStream()` for the stream path (from Task 4).

- [ ] **Step 3: Fill in streaming tests with assertions**

Use mock strategies that yield known chunks to verify buffering behavior.

- [ ] **Step 4: Run tests**

Run: `pnpm test -- lib/middleware.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add lib/functions.ts lib/middleware.test.ts
git commit -m "feat: integrate middleware into textStream with buffering for parallel timing"
```

---

### Task 7: Export types and run final verification

**Files:**
- Modify: `lib/index.ts`

- [ ] **Step 1: Export middleware types from `lib/index.ts`**

Add to `lib/index.ts`. The types are defined in `lib/middleware.ts` (not `lib/types.ts`):

```typescript
export type { MiddlewareCheck, MiddlewareConfig, MiddlewareResult } from "./middleware.js";
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `pnpm test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add lib/index.ts
git commit -m "feat: export MiddlewareCheck and MiddlewareConfig types"
```
