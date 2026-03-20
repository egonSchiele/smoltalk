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
