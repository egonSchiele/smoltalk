import { describe, it, expect } from "vitest";
import {
  fromOpenAILogprobs,
  openAIChatLogprobParams,
  topAlternatives,
  responsesOutputLogprobs,
  fromGoogleLogprobs,
  mergeGoogleLogprobs,
} from "./logprobs.js";

describe("topAlternatives", () => {
  it("returns undefined for a missing option, a missing top, and top <= 0", () => {
    expect(topAlternatives(undefined)).toBeUndefined();
    expect(topAlternatives({})).toBeUndefined();
    expect(topAlternatives({ top: 0 })).toBeUndefined();
    expect(topAlternatives({ top: 3 })).toBe(3);
  });
});

describe("openAIChatLogprobParams", () => {
  it("is empty with no option, logprobs:true alone for top 0/absent, and adds top_logprobs otherwise", () => {
    expect(openAIChatLogprobParams(undefined)).toEqual({});
    expect(openAIChatLogprobParams({})).toEqual({ logprobs: true });
    expect(openAIChatLogprobParams({ top: 0 })).toEqual({ logprobs: true });
    expect(openAIChatLogprobParams({ top: 3 })).toEqual({
      logprobs: true,
      top_logprobs: 3,
    });
  });
});

describe("fromOpenAILogprobs", () => {
  it("drops the top key when there are no alternatives, keeps it otherwise", () => {
    expect(
      fromOpenAILogprobs([
        {
          token: "Hi",
          logprob: -0.1,
          top_logprobs: [
            { token: "Hi", logprob: -0.1 },
            { token: "Hey", logprob: -1.9 },
          ],
        },
        { token: "!", logprob: -0.5, top_logprobs: [] },
      ]),
    ).toEqual([
      {
        token: "Hi",
        logprob: -0.1,
        top: [
          { token: "Hi", logprob: -0.1 },
          { token: "Hey", logprob: -1.9 },
        ],
      },
      { token: "!", logprob: -0.5 },
    ]);
    expect(fromOpenAILogprobs(undefined)).toBeUndefined();
    expect(fromOpenAILogprobs([])).toBeUndefined();
  });
});

describe("responsesOutputLogprobs", () => {
  it("collects the logprobs of every output_text part in order", () => {
    expect(
      responsesOutputLogprobs([
        { type: "reasoning" },
        {
          type: "message",
          content: [
            { type: "output_text", logprobs: [{ token: "Hi", logprob: -0.1, top_logprobs: [] }] },
            { type: "refusal" },
            { type: "output_text", logprobs: [{ token: "!", logprob: -0.5, top_logprobs: [] }] },
          ],
        },
      ]),
    ).toEqual([
      { token: "Hi", logprob: -0.1 },
      { token: "!", logprob: -0.5 },
    ]);
    expect(responsesOutputLogprobs([{ type: "message", content: [] }])).toBeUndefined();
  });
});

describe("fromGoogleLogprobs", () => {
  it("aligns chosen tokens with the top candidates of the same step", () => {
    expect(
      fromGoogleLogprobs({
        chosenCandidates: [
          { token: "Hi", logProbability: -0.1 },
          { token: "!", logProbability: -0.5 },
        ],
        topCandidates: [
          {
            candidates: [
              { token: "Hi", logProbability: -0.1 },
              { token: "Hey", logProbability: -1.9 },
            ],
          },
          { candidates: [] },
        ],
      }),
    ).toEqual([
      {
        token: "Hi",
        logprob: -0.1,
        top: [
          { token: "Hi", logprob: -0.1 },
          { token: "Hey", logprob: -1.9 },
        ],
      },
      { token: "!", logprob: -0.5 },
    ]);
    expect(fromGoogleLogprobs(undefined)).toBeUndefined();
  });

  it("merges streamed pieces in chunk order", () => {
    const first = {
      chosenCandidates: [{ token: "Hi", logProbability: -0.1 }],
      topCandidates: [{ candidates: [{ token: "Hey", logProbability: -1.9 }] }],
    };
    const second = {
      chosenCandidates: [{ token: "!", logProbability: -0.5 }],
      topCandidates: [{ candidates: [] }],
    };
    expect(fromGoogleLogprobs(mergeGoogleLogprobs([first, second]))).toEqual([
      { token: "Hi", logprob: -0.1, top: [{ token: "Hey", logprob: -1.9 }] },
      { token: "!", logprob: -0.5 },
    ]);
  });
});
