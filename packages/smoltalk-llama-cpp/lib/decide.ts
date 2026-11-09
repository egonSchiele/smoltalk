import type { DecisionQuestion as LlamaQuestion, DecisionQuestions } from "node-llama-cpp";
import type {
  DecideConfig,
  DecideProvider,
  DecideProviderReply,
  DecisionAnswer,
  DecisionQuestion,
  DecisionState,
  Result,
} from "smoltalk";
import { failure, success } from "smoltalk";
import { acquireDecisionEntry } from "./nativeRegistry.js";
import { URI_SCHEME, errorMessage } from "./shared.js";

/** A yes/no answer as node-llama-cpp returns it: the probability of yes. */
export type LlamaNoulAnswer = { type: "noul"; value: number };

export type LlamaChoiceAnswer = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};

/** A score answer as node-llama-cpp returns it: one probability per level,
 *  in level order, and no legend. */
export type LlamaScoreAnswer = {
  type: "score";
  score: number;
  confidence: number;
  probabilities: number[];
};

export type LlamaAnswer = LlamaNoulAnswer | LlamaChoiceAnswer | LlamaScoreAnswer;

function toLlamaQuestion(question: DecisionQuestion): LlamaQuestion {
  if (question.type === "noul") {
    const noul: LlamaQuestion = { type: "noul", instruction: question.instructions };
    if (question.criteria !== undefined) {
      noul.criteria = question.criteria;
    }
    return noul;
  }
  if (question.type === "choice") {
    return { type: "choice", instruction: question.instructions, criteria: question.criteria };
  }
  return { type: "score", instruction: question.instructions, criteria: question.criteria };
}

/** smoltalk's questions in node-llama-cpp's shape: `instructions` becomes
 *  `instruction`, and `criteria` passes through. */
export function toLlamaQuestions(questions: Record<string, DecisionQuestion>): DecisionQuestions {
  const out: Record<string, LlamaQuestion> = {};
  for (const name of Object.keys(questions)) {
    out[name] = toLlamaQuestion(questions[name]);
  }
  return out;
}

function fromLlamaAnswer(question: DecisionQuestion, answer: LlamaAnswer): DecisionAnswer {
  if (answer.type === "noul") {
    return { type: "noul", noul: answer.value };
  }
  if (answer.type === "choice") {
    return {
      type: "choice",
      choice: answer.choice,
      confidence: answer.confidence,
      probabilities: answer.probabilities,
    };
  }
  const probabilities: Record<string, number> = {};
  answer.probabilities.forEach((probability, index) => {
    probabilities[String(index)] = probability;
  });
  // node-llama-cpp returns no legend, so it is built from the question.
  const legend: Record<string, string> = {};
  if (question.type === "score") {
    question.criteria.forEach((description, index) => {
      legend[String(index)] = description;
    });
  }
  return {
    type: "score",
    score: answer.score,
    confidence: answer.confidence,
    legend,
    probabilities,
  };
}

/** node-llama-cpp's answers in smoltalk's shape. */
export function fromLlamaAnswers(
  questions: Record<string, DecisionQuestion>,
  answers: Record<string, LlamaAnswer>,
): Record<string, DecisionAnswer> {
  const out: Record<string, DecisionAnswer> = {};
  for (const name of Object.keys(answers)) {
    out[name] = fromLlamaAnswer(questions[name], answers[name]);
  }
  return out;
}

function toDocument(state: DecisionState): string {
  if (typeof state === "string") {
    return state;
  }
  return JSON.stringify(state, null, 2);
}

/**
 * Answer decisions with a local GGUF file through node-llama-cpp's decision
 * context. `config.model` is the file's path. Any small chat model works; the
 * library reads how likely each answer is.
 *
 * The context is at most 4,096 tokens (the library's default), and the state
 * plus the questions must fit: a document that does not fit fails rather
 * than being truncated, since a decision on a cut-off document is worse
 * than none.
 */
export const decide: DecideProvider = async (
  state: DecisionState,
  questions: Record<string, DecisionQuestion>,
  config: DecideConfig,
): Promise<Result<DecideProviderReply>> => {
  const modelPath = config.model;
  if (URI_SCHEME.test(modelPath)) {
    return failure(
      `smoltalk-llama-cpp: decisions need a local .gguf path. ` +
        `To download or resolve "${modelPath}", call resolveModel() first and pass its result as the model.`,
    );
  }
  if (config.abortSignal?.aborted) {
    return failure("Request was aborted");
  }
  let document: string;
  try {
    document = toDocument(state);
  } catch (err) {
    // A circular object or a BigInt cannot be turned into JSON.
    return failure(
      `smoltalk-llama-cpp: the state could not be turned into JSON: ${errorMessage(err)}`,
    );
  }

  let entry;
  try {
    entry = await acquireDecisionEntry(modelPath);
  } catch (err) {
    return failure(
      `smoltalk-llama-cpp: could not load ${modelPath} for decisions: ${errorMessage(err)}`,
    );
  }

  try {
    return await entry.lock.runExclusive(async () => {
      // The call may have waited behind another one for the lock.
      if (config.abortSignal?.aborted) {
        return failure("Request was aborted");
      }
      const reply = await entry.context.decideWithMeta(document, toLlamaQuestions(questions), {
        signal: config.abortSignal,
      });
      return success({
        answers: fromLlamaAnswers(questions, reply.answers as Record<string, LlamaAnswer>),
        usage: { inputTokens: reply.tokenUsage.input, outputTokens: reply.tokenUsage.output },
      });
    });
  } catch (err) {
    if (config.abortSignal?.aborted) {
      return failure("Request was aborted");
    }
    return failure(`smoltalk-llama-cpp: deciding with ${modelPath} failed: ${errorMessage(err)}`);
  }
};
