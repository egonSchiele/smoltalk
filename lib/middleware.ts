import { ZodType } from "zod";
import { Message } from "./classes/message/index.js";
import { PromptConfig, PromptResult, SmolPromptConfig, success } from "./types.js";
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
    aggregatedCost = addCosts(aggregatedCost, checkResult.cost);

    if (checkResult.blocked) {
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
