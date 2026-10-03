import { assistantMessage, userMessage } from "../classes/message/index.js";
import type { PromptResult, SmolConfig } from "../types.js";
import { addCosts } from "../types/costEstimate.js";
import { addTokenUsage } from "../types/tokenUsage.js";
import { success, type Result } from "../types/result.js";
import { endsInValidationRetry } from "./validationRetry.js";

/**
 * A local model cannot be held to a JSON schema while it may still call a
 * tool: a tool call is not JSON, so the servers leave the schema unenforced
 * on any request that carries tools, and the model is free to answer in
 * prose. A call with both tools and a `responseFormat` is therefore made as
 * two requests, the way the Google client does it. The first carries the
 * tools and no schema. If the model calls a tool, that is the result. If it
 * answers, a second request asks for that answer in the schema, with tool
 * calls ruled out so the schema can be enforced.
 *
 * Unlike the Google client, the second request keeps the whole conversation.
 * A schema field such as "did this answer everything the user asked?" cannot
 * be filled in from the answer alone.
 */

/** What the second request says, after the model's own answer. */
export const STRUCTURED_FOLLOW_UP =
  "Give that same reply again in the required JSON format. Do not call a tool.";

/** Whether a call's typed reply is made as a second request. */
export function separatesStructuredOutput(config: SmolConfig): boolean {
  const hasTools = (config.tools?.length ?? 0) > 0;
  if (!hasTools || !config.responseFormat) {
    return false;
  }
  return config.responseFormatOptions?.separateFromTools !== false;
}

/**
 * The format request's result as the caller sees it. The request rules tool
 * calls out, but a server too old to honour that could still return one. It
 * must not be run: the tool round is over. Such a reply has no text either,
 * so `fallback` stands in for it. The caller's validation then fails on the
 * fallback and asks again, instead of finding nothing to validate.
 */
function formatReply(result: PromptResult, fallback: string): PromptResult {
  return { ...result, toolCalls: [], output: result.output || fallback };
}

/**
 * Makes the two requests. `run` sends one request. `formatConfig` turns the
 * follow-up config into one whose schema the provider will enforce: the MLX
 * client sets `tool_choice: "none"`, the llama.cpp client drops the tools.
 *
 * When the reply fails the caller's validation, the caller sends the
 * conversation back with a request to fix it. The model has already answered
 * by then, so only the format request is made. A tool round there would let
 * the model answer "fix this JSON" with a tool call, and a tool that has
 * already run would run again.
 */
export async function toolsThenStructuredOutput(args: {
  config: SmolConfig;
  run: (config: SmolConfig) => Promise<Result<PromptResult>>;
  formatConfig: (config: SmolConfig) => SmolConfig;
}): Promise<Result<PromptResult>> {
  const { config, run, formatConfig } = args;

  if (endsInValidationRetry(config.messages)) {
    const only = await run(formatConfig(config));
    return only.success ? success(formatReply(only.value, "")) : only;
  }

  const first = await run({ ...config, responseFormat: undefined });
  if (!first.success) {
    return first;
  }
  // A tool call is the whole reply. An empty reply has nothing to put in
  // the format, so it goes back as it is and fails validation as before.
  if (first.value.toolCalls.length > 0 || !first.value.output) {
    return first;
  }
  const answer = first.value.output;

  const second = await run(
    formatConfig({
      ...config,
      messages: [...config.messages, assistantMessage(answer), userMessage(STRUCTURED_FOLLOW_UP)],
    }),
  );
  if (!second.success) {
    return second;
  }

  const thinkingBlocks = [
    ...(first.value.thinkingBlocks ?? []),
    ...(second.value.thinkingBlocks ?? []),
  ];
  const merged: PromptResult = {
    ...formatReply(second.value, answer),
    usage: addTokenUsage(first.value.usage, second.value.usage),
    cost: addCosts(first.value.cost, second.value.cost),
  };
  if (thinkingBlocks.length > 0) {
    merged.thinkingBlocks = thinkingBlocks;
  }
  return success(merged);
}
