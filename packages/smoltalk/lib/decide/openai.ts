/**
 * OpenAI's Decisions API (`POST /v1/decisions`, model `gpt-6-luna`).
 *
 * smoltalk's public decision types are the System One format. OpenAI's
 * request and reply are shaped differently, so this file translates both
 * ways and a caller writes the same decide() call for either:
 *
 * - a noul is a `predicate`, a choice's criteria map is a `choices` list, a
 *   score's criteria list is a `levels` list labelled "0", "1", ...;
 * - answers come back as a list in question order, not a map;
 * - a question can come back as a `refusal`, which fails the whole call.
 *
 * Reference: https://developers.openai.com/api/reference/resources/decisions/methods/create
 * Guide: https://developers.openai.com/api/docs/guides/decisions
 */
import { z } from "zod";
import type {
  DecisionAnswer,
  DecisionQuestion,
  DecisionState,
  DecideProviderReply,
} from "../decide.js";
import { Result, success, failure } from "../types/result.js";
import { shapeFailure } from "./http.js";

export type OpenAiJsonPart = { type: "input_json"; data: object };

export type OpenAiUserMessage = { role: "user"; content: OpenAiJsonPart[] };

export type OpenAiPredicateQuestion = {
  type: "predicate";
  name: string;
  instructions: string;
};

export type OpenAiChoiceOption = { value: string; description: string };

export type OpenAiChoiceQuestion = {
  type: "choice";
  name: string;
  instructions: string;
  choices: OpenAiChoiceOption[];
};

export type OpenAiScoreLevel = { label: string; description: string };

export type OpenAiScoreQuestion = {
  type: "score";
  name: string;
  instructions: string;
  levels: OpenAiScoreLevel[];
};

export type OpenAiQuestion = OpenAiPredicateQuestion | OpenAiChoiceQuestion | OpenAiScoreQuestion;

export type OpenAiDecisionRequest = {
  model: string;
  input: string | OpenAiUserMessage[];
  questions: OpenAiQuestion[];
};

const AnswerNameSchema = z.string().nullable().optional();

const PredicateAnswerSchema = z.object({
  type: z.literal("predicate"),
  name: AnswerNameSchema,
  probability: z.number(),
});

const ChoiceProbabilitySchema = z.object({
  value: z.union([z.string(), z.boolean()]),
  probability: z.number(),
});

const ChoiceAnswerSchema = z.object({
  type: z.literal("choice"),
  name: AnswerNameSchema,
  choice: z.union([z.string(), z.boolean()]),
  confidence: z.number(),
  probabilities: z.array(ChoiceProbabilitySchema),
});

const ScoreProbabilitySchema = z.object({
  value: z.number(),
  label: z.string(),
  probability: z.number(),
});

const ScoreAnswerSchema = z.object({
  type: z.literal("score"),
  name: AnswerNameSchema,
  score: z.number(),
  confidence: z.number(),
  probabilities: z.array(ScoreProbabilitySchema),
});

const RefusalAnswerSchema = z.object({
  type: z.literal("refusal"),
  name: AnswerNameSchema,
});

const AnswerSchema = z.discriminatedUnion("type", [
  PredicateAnswerSchema,
  ChoiceAnswerSchema,
  ScoreAnswerSchema,
  RefusalAnswerSchema,
]);

const ReplySchema = z.object({
  model: z.string().optional(),
  answers: z.array(AnswerSchema),
  usage: z
    .object({
      input_tokens: z.number(),
      output_tokens: z.number().optional(),
    })
    .optional(),
});

export type OpenAiPredicateAnswer = z.infer<typeof PredicateAnswerSchema>;
export type OpenAiChoiceProbability = z.infer<typeof ChoiceProbabilitySchema>;
export type OpenAiChoiceAnswer = z.infer<typeof ChoiceAnswerSchema>;
export type OpenAiScoreProbability = z.infer<typeof ScoreProbabilitySchema>;
export type OpenAiScoreAnswer = z.infer<typeof ScoreAnswerSchema>;
export type OpenAiRefusalAnswer = z.infer<typeof RefusalAnswerSchema>;
export type OpenAiAnswer = z.infer<typeof AnswerSchema>;
export type OpenAiDecisionReply = z.infer<typeof ReplySchema>;

function isPlainObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** OpenAI's JSON part takes an object or an array of objects, going by the
 *  reference's type for `data`. This follows that type, not a tested limit:
 *  do not loosen it without a real request showing OpenAI accepts more. */
function fitsJsonPart(state: DecisionState): boolean {
  if (Array.isArray(state)) {
    return state.every(isPlainObject);
  }
  return isPlainObject(state);
}

function toOpenAiInput(state: DecisionState): string | OpenAiUserMessage[] {
  if (typeof state === "string") {
    return state;
  }
  if (fitsJsonPart(state)) {
    return [{ role: "user", content: [{ type: "input_json", data: state }] }];
  }
  return JSON.stringify(state);
}

function toOpenAiQuestion(name: string, question: DecisionQuestion): OpenAiQuestion {
  if (question.type === "noul") {
    let instructions = question.instructions;
    // OpenAI has no field for a noul's criteria, so they go in the text.
    if (question.criteria !== undefined) {
      instructions += `\nTrue when: ${question.criteria.true}\nFalse when: ${question.criteria.false}`;
    }
    return { type: "predicate", name, instructions };
  }
  if (question.type === "choice") {
    const choices = Object.keys(question.criteria).map((value) => ({
      value,
      description: question.criteria[value],
    }));
    return { type: "choice", name, instructions: question.instructions, choices };
  }
  // Each level is labelled with its position, and the reply is read back by
  // that label, so the translation does not depend on OpenAI's numbering.
  const levels = question.criteria.map((description, index) => ({
    label: String(index),
    description,
  }));
  return { type: "score", name, instructions: question.instructions, levels };
}

/** smoltalk's decision request in OpenAI's shape. */
export function toOpenAiRequest(
  model: string,
  state: DecisionState,
  questions: Record<string, DecisionQuestion>,
): OpenAiDecisionRequest {
  const openAiQuestions = Object.keys(questions).map((name) =>
    toOpenAiQuestion(name, questions[name]),
  );
  return { model, input: toOpenAiInput(state), questions: openAiQuestions };
}

/** A reply body checked against OpenAI's shape. */
export function parseOpenAiReply(body: unknown): Result<OpenAiDecisionReply> {
  const parsed = ReplySchema.safeParse(body);
  if (!parsed.success) {
    return shapeFailure(parsed.error);
  }
  return success(parsed.data);
}

function refusalFailure(names: string[]): Result<never> {
  const quoted = names.map((name) => `"${name}"`).join(", ");
  if (names.length === 1) {
    return failure(`OpenAI refused to answer question ${quoted}.`);
  }
  return failure(`OpenAI refused to answer questions ${quoted}.`);
}

function booleanOptionFailure(name: string): Result<never> {
  return failure(
    `OpenAI answered question "${name}" with a boolean option, but smoltalk sends only string options.`,
  );
}

function fromChoiceAnswer(name: string, answer: OpenAiChoiceAnswer): Result<DecisionAnswer> {
  if (typeof answer.choice !== "string") {
    return booleanOptionFailure(name);
  }
  const probabilities: Record<string, number> = {};
  for (const item of answer.probabilities) {
    if (typeof item.value !== "string") {
      return booleanOptionFailure(name);
    }
    probabilities[item.value] = item.probability;
  }
  return success({
    type: "choice",
    choice: answer.choice,
    confidence: answer.confidence,
    probabilities,
  });
}

function fromScoreAnswer(
  name: string,
  question: DecisionQuestion,
  answer: OpenAiScoreAnswer,
): Result<DecisionAnswer> {
  const probabilities: Record<string, number> = {};
  for (const item of answer.probabilities) {
    if (String(item.value) !== item.label) {
      return failure(
        `OpenAI numbered level "${item.label}" of question "${name}" as ${item.value}; smoltalk expects levels counted from 0.`,
      );
    }
    probabilities[item.label] = item.probability;
  }
  // OpenAI returns no legend, so it is built from the question's own levels.
  const legend: Record<string, string> = {};
  if (question.type === "score") {
    question.criteria.forEach((description, index) => {
      legend[String(index)] = description;
    });
  }
  // OpenAI's guide: "Level indices start at 0", as smoltalk counts.
  return success({
    type: "score",
    score: answer.score,
    confidence: answer.confidence,
    legend,
    probabilities,
  });
}

/** OpenAI's reply in smoltalk's shape. Answers are paired with questions by
 *  position. A refusal of any question fails the whole call: DecideResult
 *  has no refusal type, and a partial set of answers is not safe to use. */
export function fromOpenAiReply(
  questions: Record<string, DecisionQuestion>,
  reply: OpenAiDecisionReply,
): Result<DecideProviderReply> {
  const names = Object.keys(questions);
  if (reply.answers.length !== names.length) {
    return failure(
      `OpenAI returned ${reply.answers.length} answers for ${names.length} questions.`,
    );
  }

  const refused: string[] = [];
  const answers: Record<string, DecisionAnswer> = {};
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const answer = reply.answers[i];
    if (typeof answer.name === "string" && answer.name !== name) {
      return failure(
        `OpenAI's answer ${i + 1} is named "${answer.name}", but question ${i + 1} is "${name}".`,
      );
    }
    if (answer.type === "refusal") {
      refused.push(name);
      continue;
    }
    if (answer.type === "predicate") {
      answers[name] = { type: "noul", noul: answer.probability };
      continue;
    }
    let translated: Result<DecisionAnswer>;
    if (answer.type === "choice") {
      translated = fromChoiceAnswer(name, answer);
    } else {
      translated = fromScoreAnswer(name, questions[name], answer);
    }
    if (!translated.success) {
      return translated;
    }
    answers[name] = translated.value;
  }
  if (refused.length > 0) {
    return refusalFailure(refused);
  }

  const result: DecideProviderReply = {
    answers,
    usage: {
      inputTokens: reply.usage?.input_tokens ?? 0,
      outputTokens: reply.usage?.output_tokens ?? 0,
    },
  };
  if (reply.model !== undefined) {
    result.model = reply.model;
  }
  return success(result);
}
