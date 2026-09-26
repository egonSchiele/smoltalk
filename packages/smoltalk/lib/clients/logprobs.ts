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

type ResponsesOutputPart = { type: string; logprobs?: OpenAILogprob[] };
type ResponsesOutputItem = { type: string; content?: ResponsesOutputPart[] };

/** The logprobs of every `output_text` part of a Responses API `output`,
 *  in order, as smoltalk's shape. */
export function responsesOutputLogprobs(
  output: ResponsesOutputItem[],
): TokenLogprob[] | undefined {
  const textParts = output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text");
  return fromOpenAILogprobs(textParts.flatMap((part) => part.logprobs ?? []));
}

type GoogleCandidate = { token?: string; logProbability?: number };
type GoogleTopCandidates = { candidates?: GoogleCandidate[] };
export type GoogleLogprobsResult = {
  chosenCandidates?: GoogleCandidate[];
  topCandidates?: GoogleTopCandidates[];
};

function googleAlternative(candidate: GoogleCandidate): TokenAlternative {
  return {
    token: candidate.token ?? "",
    logprob: candidate.logProbability ?? 0,
  };
}

/** Gemini's `logprobsResult` as smoltalk's shape: one entry per chosen
 *  token, with the top candidates at the same step as its alternatives. */
export function fromGoogleLogprobs(
  result: GoogleLogprobsResult | undefined,
): TokenLogprob[] | undefined {
  const chosen = result?.chosenCandidates ?? [];
  if (chosen.length === 0) {
    return undefined;
  }
  return chosen.map((candidate, step) =>
    tokenLogprob(
      candidate.token ?? "",
      candidate.logProbability ?? 0,
      (result?.topCandidates?.[step]?.candidates ?? []).map(googleAlternative),
    ),
  );
}

/** The `logprobsResult` pieces of a streamed Gemini reply as one result,
 *  in chunk order. Each chunk's piece must cover only that chunk's tokens
 *  (deltas, like OpenAI's stream). */
export function mergeGoogleLogprobs(
  partials: GoogleLogprobsResult[],
): GoogleLogprobsResult {
  return {
    chosenCandidates: partials.flatMap(
      (partial) => partial.chosenCandidates ?? [],
    ),
    topCandidates: partials.flatMap((partial) => partial.topCandidates ?? []),
  };
}
