import type { TokenAlternative, TokenLogprob } from "../types.js";

export type OpenAILogprob = {
  token: string;
  logprob: number;
  top_logprobs?: TokenAlternative[];
};

/** One entry in smoltalk's shape. `top` is present only when there are
 *  alternatives, so an entry without them serializes without the key. */
function tokenLogprob(
  token: string,
  logprob: number,
  top: TokenAlternative[],
): TokenLogprob {
  if (top.length === 0) {
    return { token, logprob };
  }
  return { token, logprob, top };
}

function openAIAlternative(entry: TokenAlternative): TokenAlternative {
  return { token: entry.token, logprob: entry.logprob };
}

/** OpenAI's per-token entries (chat `choices[].logprobs.content` and
 *  Responses `output_text.logprobs`) as smoltalk's shape. Undefined when
 *  there are none, so the result field stays absent. */
export function fromOpenAILogprobs(
  entries: OpenAILogprob[] | null | undefined,
): TokenLogprob[] | undefined {
  if (!entries || entries.length === 0) {
    return undefined;
  }
  return entries.map((entry) =>
    tokenLogprob(
      entry.token,
      entry.logprob,
      (entry.top_logprobs ?? []).map(openAIAlternative),
    ),
  );
}

/** How many alternatives per token a `logprobs` option asks for, or
 *  undefined for none. `top: 0` and a missing `top` both mean none. */
export function topAlternatives(
  option: { top?: number } | undefined,
): number | undefined {
  if (option?.top === undefined || option.top <= 0) {
    return undefined;
  }
  return option.top;
}

type OpenAIChatLogprobParams = { logprobs?: true; top_logprobs?: number };

/** The chat API's request parameters for a `logprobs` option: `logprobs: true`
 *  whenever the option is set, `top_logprobs` only when alternatives were
 *  asked for (the API rejects `top_logprobs` without `logprobs: true`). */
export function openAIChatLogprobParams(
  option: { top?: number } | undefined,
): OpenAIChatLogprobParams {
  if (option === undefined) {
    return {};
  }
  const top = topAlternatives(option);
  if (top === undefined) {
    return { logprobs: true };
  }
  return { logprobs: true, top_logprobs: top };
}
