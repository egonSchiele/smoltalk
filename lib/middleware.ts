import { ZodType } from "zod";
import { Message } from "./classes/message/index.js";
import { PromptConfig, PromptResult, SmolPromptConfig, StreamChunk, success } from "./types.js";
import { Result } from "./types/result.js";
import { addTokenUsage, TokenUsage } from "./types/tokenUsage.js";
import { addCosts, CostEstimate } from "./types/costEstimate.js";

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

export type MiddlewareResult = {
  blocked: boolean;
  result: Result<PromptResult>;
  usage?: TokenUsage;
  cost?: CostEstimate;
};

/**
 * Run a single middleware check. Returns a MiddlewareResult indicating
 * whether the check blocked and what output to use.
 */
export async function runMiddlewareCheck(
  check: MiddlewareCheck,
  parentConfig: SmolPromptConfig,
  textSyncFn: (config: SmolPromptConfig) => Promise<Result<PromptResult>>,
): Promise<MiddlewareResult> {
  const middlewareConfig: SmolPromptConfig = {
    ...parentConfig,
    messages: [...check.messages, ...parentConfig.messages],
    responseFormat: check.responseFormat,
    responseFormatOptions: check.responseFormatOptions,
    middleware: undefined,
    stream: undefined,
  };

  let llmResult: Result<PromptResult>;
  try {
    llmResult = await textSyncFn(middlewareConfig);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      blocked: true,
      result: success({
        output: `Middleware check failed: ${errorMsg}`,
        toolCalls: [],
      }),
    };
  }

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

  const middlewareUsage = llmResult.value.usage;
  const middlewareCost = llmResult.value.cost;

  let decision: string | null;
  try {
    decision = check.decide(llmResult.value);
  } catch (err) {
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

  return {
    blocked: false,
    result: llmResult,
    usage: middlewareUsage,
    cost: middlewareCost,
  };
}

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
    aggregatedCost = safeAddCosts(aggregatedCost, checkResult.cost);

    if (checkResult.blocked) {
      if (checkResult.result.success) {
        checkResult.result.value.usage = aggregatedUsage;
        checkResult.result.value.cost = aggregatedCost;
      }
      return { ...checkResult, usage: aggregatedUsage, cost: aggregatedCost };
    }
  }

  // When all checks pass, result is a placeholder — callers check `blocked` first
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
    aggregatedCost = safeAddCosts(aggregatedCost, r.cost);
  }

  const firstBlocked = results.find((r) => r.blocked);
  if (firstBlocked) {
    if (firstBlocked.result.success) {
      firstBlocked.result.value.usage = aggregatedUsage;
      firstBlocked.result.value.cost = aggregatedCost;
    }
    return { ...firstBlocked, usage: aggregatedUsage, cost: aggregatedCost };
  }

  // When all checks pass, result is a placeholder — callers check `blocked` first
  return {
    blocked: false,
    result: success({ output: null, toolCalls: [] }),
    usage: aggregatedUsage,
    cost: aggregatedCost,
  };
}

/**
 * Wrapper around addCosts that handles currency mismatch gracefully.
 * If currencies differ, returns the first non-undefined cost (best effort).
 */
function safeAddCosts(a?: CostEstimate, b?: CostEstimate): CostEstimate | undefined {
  try {
    return addCosts(a, b);
  } catch {
    // addCosts throws on currency mismatch — return whichever is available
    return a ?? b;
  }
}

function stripMiddleware(config: SmolPromptConfig): SmolPromptConfig {
  const { middleware, ...rest } = config;
  return rest as SmolPromptConfig;
}

/**
 * High-level middleware orchestration for sync calls.
 * Returns the blocked result if middleware blocks, the main prompt result for parallel timing,
 * or null to indicate "proceed normally" (no middleware or middleware passed with "before" timing).
 */
export async function executeMiddlewareSync(
  config: SmolPromptConfig,
  runMainPrompt: (config: SmolPromptConfig) => Promise<Result<PromptResult>>,
  textSyncFn: (config: SmolPromptConfig) => Promise<Result<PromptResult>>,
): Promise<Result<PromptResult> | null> {
  const middleware = config.middleware;
  if (!middleware || middleware.checks.length === 0) return null;

  const configWithoutMiddleware = stripMiddleware(config);

  if (middleware.timing === "before") {
    const middlewareResult = await runMiddlewareChecks(
      middleware.checks,
      middleware.mode,
      configWithoutMiddleware,
      textSyncFn,
    );
    return middlewareResult.blocked ? middlewareResult.result : null;
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

    const mainPromise = runMainPrompt({
      ...configWithoutMiddleware,
      abortSignal: mainAbort.signal,
    });

    const middlewareResult = await runMiddlewareChecks(
      middleware.checks,
      middleware.mode,
      { ...configWithoutMiddleware, abortSignal: middlewareAbort.signal },
      textSyncFn,
    );

    if (middlewareResult.blocked) {
      mainAbort.abort();
      return middlewareResult.result;
    }

    return await mainPromise;
  }

  return null;
}

/**
 * High-level middleware orchestration for streaming calls.
 * Yields stream chunks, handling middleware checks according to timing config.
 * Only call this when middleware is configured — the caller should check first.
 */
export async function* executeMiddlewareStream(
  config: SmolPromptConfig,
  getStream: (config: SmolPromptConfig) => AsyncGenerator<StreamChunk>,
  textSyncFn: (config: SmolPromptConfig) => Promise<Result<PromptResult>>,
): AsyncGenerator<StreamChunk> {
  const middleware = config.middleware!;
  const configWithoutMiddleware = stripMiddleware(config);

  if (middleware.timing === "before") {
    const middlewareResult = await runMiddlewareChecks(
      middleware.checks,
      middleware.mode,
      configWithoutMiddleware,
      textSyncFn,
    );

    if (middlewareResult.blocked) {
      if (middlewareResult.result.success) {
        yield { type: "done", result: middlewareResult.result.value };
      } else {
        yield { type: "error", error: middlewareResult.result.error };
      }
      return;
    }

    yield* getStream(configWithoutMiddleware);
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

    const stream = getStream({
      ...configWithoutMiddleware,
      abortSignal: mainAbort.signal,
    });

    const middlewarePromise = runMiddlewareChecks(
      middleware.checks,
      middleware.mode,
      { ...configWithoutMiddleware, abortSignal: middlewareAbort.signal },
      textSyncFn,
    );

    const buffer: StreamChunk[] = [];
    let streamDone = false;
    let middlewareSettled = false;
    let middlewareResult!: MiddlewareResult;

    const middlewareFinished = middlewarePromise.then((r) => {
      middlewareSettled = true;
      middlewareResult = r;
      return r;
    });

    // Manually iterate so that `break` does not close the generator.
    // Note: the loop only checks `middlewareSettled` after each chunk arrives,
    // so if middleware settles while we're blocked on `iterator.next()`, we buffer
    // one extra chunk before reacting. This is bounded by the inter-chunk latency
    // (typically sub-second for LLM streaming) and is safe — it just means we may
    // buffer slightly more than strictly necessary.
    const iterator = stream[Symbol.asyncIterator]();
    while (true) {
      const { value: chunk, done } = await iterator.next();
      if (done) {
        streamDone = true;
        break;
      }
      buffer.push(chunk);
      if (chunk.type === "done" || chunk.type === "error") {
        streamDone = true;
      }
      if (middlewareSettled) break;
    }

    if (!middlewareSettled) {
      middlewareResult = await middlewareFinished;
    }

    if (middlewareResult.blocked) {
      mainAbort.abort();
      if (middlewareResult.result.success) {
        yield { type: "done", result: middlewareResult.result.value };
      } else {
        yield { type: "error", error: middlewareResult.result.error };
      }
      return;
    }

    for (const chunk of buffer) {
      yield chunk;
    }
    if (!streamDone) {
      while (true) {
        const { value: chunk, done } = await iterator.next();
        if (done) break;
        yield chunk;
      }
    }
    return;
  }
}
