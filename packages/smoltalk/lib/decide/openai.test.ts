import { describe, it, expect } from "vitest";
import type { DecisionQuestion } from "../decide.js";
import {
  toOpenAiRequest,
  fromOpenAiReply,
  parseOpenAiReply,
  type OpenAiDecisionReply,
} from "./openai.js";

const questions: Record<string, DecisionQuestion> = {
  team: {
    type: "choice",
    instructions: "Which team?",
    criteria: { billing: "payments, refunds", support: "help, bugs" },
  },
  urgency: {
    type: "score",
    instructions: "How urgent?",
    criteria: ["not urgent", "urgent", "critical"],
  },
  churn: { type: "noul", instructions: "Likely to cancel?" },
};

const usage = { input_tokens: 40, output_tokens: 0 };

function reply(answers: unknown[]): OpenAiDecisionReply {
  return { model: "gpt-6-luna", answers, usage } as OpenAiDecisionReply;
}

const goodAnswers = [
  {
    type: "choice",
    name: "team",
    choice: "billing",
    confidence: 0.8,
    probabilities: [
      { value: "billing", probability: 0.8 },
      { value: "support", probability: 0.2 },
    ],
  },
  {
    type: "score",
    name: "urgency",
    score: 1.1,
    confidence: 0.5,
    probabilities: [
      { value: 0, label: "0", probability: 0.2 },
      { value: 1, label: "1", probability: 0.5 },
      { value: 2, label: "2", probability: 0.3 },
    ],
  },
  { type: "predicate", name: "churn", probability: 0.1 },
];

describe("toOpenAiRequest", () => {
  it("turns each question type into OpenAI's, named by its key, in key order", () => {
    const req = toOpenAiRequest("gpt-6-luna", "hi", questions);
    expect(req.model).toBe("gpt-6-luna");
    expect(req.questions).toEqual([
      {
        type: "choice",
        name: "team",
        instructions: "Which team?",
        choices: [
          { value: "billing", description: "payments, refunds" },
          { value: "support", description: "help, bugs" },
        ],
      },
      {
        type: "score",
        name: "urgency",
        instructions: "How urgent?",
        levels: [
          { label: "0", description: "not urgent" },
          { label: "1", description: "urgent" },
          { label: "2", description: "critical" },
        ],
      },
      { type: "predicate", name: "churn", instructions: "Likely to cancel?" },
    ]);
  });

  it("appends a noul's criteria to its instructions", () => {
    const req = toOpenAiRequest("gpt-6-luna", "hi", {
      refund: {
        type: "noul",
        instructions: "Money back?",
        criteria: { true: "asks for a refund", false: "anything else" },
      },
    });
    expect(req.questions).toEqual([
      {
        type: "predicate",
        name: "refund",
        instructions: "Money back?\nTrue when: asks for a refund\nFalse when: anything else",
      },
    ]);
  });

  it("sends a string state as the input", () => {
    expect(toOpenAiRequest("m", "a ticket", questions).input).toBe("a ticket");
  });

  it("sends an object, or an array of objects, as one JSON part in a user message", () => {
    const state = { subject: "refund" };
    expect(toOpenAiRequest("m", state, questions).input).toEqual([
      { role: "user", content: [{ type: "input_json", data: state }] },
    ]);
    const rows = [{ id: 1 }, { id: 2 }];
    expect(toOpenAiRequest("m", rows, questions).input).toEqual([
      { role: "user", content: [{ type: "input_json", data: rows }] },
    ]);
  });

  it("sends any other JSON value as its JSON text", () => {
    expect(toOpenAiRequest("m", ["a", 1], questions).input).toBe('["a",1]');
    expect(toOpenAiRequest("m", [{ id: 1 }, "x"], questions).input).toBe('[{"id":1},"x"]');
  });
});

describe("fromOpenAiReply", () => {
  it("turns each answer type into smoltalk's", () => {
    const r = fromOpenAiReply(questions, reply(goodAnswers));
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.value).toEqual({
      answers: {
        team: {
          type: "choice",
          choice: "billing",
          confidence: 0.8,
          probabilities: { billing: 0.8, support: 0.2 },
        },
        urgency: {
          type: "score",
          score: 1.1,
          confidence: 0.5,
          legend: { "0": "not urgent", "1": "urgent", "2": "critical" },
          probabilities: { "0": 0.2, "1": 0.5, "2": 0.3 },
        },
        churn: { type: "noul", noul: 0.1 },
      },
      usage: { inputTokens: 40, outputTokens: 0 },
      model: "gpt-6-luna",
    });
  });

  it("pairs answers by position when OpenAI sends no name", () => {
    const unnamed = goodAnswers.map((a) => ({ ...a, name: null }));
    const r = fromOpenAiReply(questions, reply(unnamed));
    expect(r.success).toBe(true);
    if (r.success) expect(r.value.answers.churn).toEqual({ type: "noul", noul: 0.1 });
  });

  it("fails on one refusal and names the question", () => {
    const answers = [goodAnswers[0], goodAnswers[1], { type: "refusal", name: "churn" }];
    const r = fromOpenAiReply(questions, reply(answers));
    expect(r).toEqual({ success: false, error: 'OpenAI refused to answer question "churn".' });
  });

  it("fails on two refusals and names both", () => {
    const answers = [{ type: "refusal", name: "team" }, goodAnswers[1], { type: "refusal", name: "churn" }];
    const r = fromOpenAiReply(questions, reply(answers));
    expect(r).toEqual({
      success: false,
      error: 'OpenAI refused to answer questions "team", "churn".',
    });
  });

  it("fails on fewer or more answers than questions", () => {
    const fewer = fromOpenAiReply(questions, reply(goodAnswers.slice(0, 2)));
    expect(fewer).toEqual({
      success: false,
      error: "OpenAI returned 2 answers for 3 questions.",
    });
    const more = fromOpenAiReply(questions, reply([...goodAnswers, goodAnswers[2]]));
    expect(more).toEqual({
      success: false,
      error: "OpenAI returned 4 answers for 3 questions.",
    });
  });

  it("fails when an answer's name is not its question's", () => {
    const swapped = [goodAnswers[0], goodAnswers[1], { ...goodAnswers[2], name: "refund" }];
    const r = fromOpenAiReply(questions, reply(swapped));
    expect(r).toEqual({
      success: false,
      error: 'OpenAI\'s answer 3 is named "refund", but question 3 is "churn".',
    });
  });

  it("passes a score through unchanged, since OpenAI counts levels from 0", () => {
    const r = fromOpenAiReply(questions, reply(goodAnswers));
    expect(r.success).toBe(true);
    if (r.success && r.value.answers.urgency.type === "score") {
      expect(r.value.answers.urgency.score).toBe(1.1);
    }
  });

  it("fails when a score item's value disagrees with its label", () => {
    const shifted = {
      ...goodAnswers[1],
      probabilities: [
        { value: 1, label: "0", probability: 0.2 },
        { value: 2, label: "1", probability: 0.5 },
        { value: 3, label: "2", probability: 0.3 },
      ],
    };
    const r = fromOpenAiReply(questions, reply([goodAnswers[0], shifted, goodAnswers[2]]));
    expect(r).toEqual({
      success: false,
      error: 'OpenAI numbered level "0" of question "urgency" as 1; smoltalk expects levels counted from 0.',
    });
  });

  it("fails on a boolean choice or value, since smoltalk sends only string options", () => {
    const boolChoice = { ...goodAnswers[0], choice: true };
    const r = fromOpenAiReply(questions, reply([boolChoice, goodAnswers[1], goodAnswers[2]]));
    expect(r).toEqual({
      success: false,
      error: 'OpenAI answered question "team" with a boolean option, but smoltalk sends only string options.',
    });
    const boolValue = {
      ...goodAnswers[0],
      probabilities: [{ value: false, probability: 1 }],
    };
    const r2 = fromOpenAiReply(questions, reply([boolValue, goodAnswers[1], goodAnswers[2]]));
    expect(r2.success).toBe(false);
  });
});

describe("parseOpenAiReply", () => {
  it("accepts a reply in OpenAI's shape", () => {
    const r = parseOpenAiReply({ model: "gpt-6-luna", answers: goodAnswers, usage });
    expect(r.success).toBe(true);
  });

  it("fails with the same wording as the System One provider", () => {
    const r = parseOpenAiReply({ answers: [{ type: "predicate", name: "churn" }] });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toMatch(/^Decision response has an unexpected shape at answers\.0/);
    }
  });
});
