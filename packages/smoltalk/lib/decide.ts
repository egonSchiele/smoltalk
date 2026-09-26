/**
 * Decision models: typed questions in, probabilities out.
 *
 * A decision model such as TypeSafe's Jev, or the open-weights Laya, does not
 * generate text. You send it a state (text or JSON) and a map of questions,
 * and it answers every question in one forward pass. There are three question
 * types: a yes/no `noul`, a `choice` from a fixed set of options, and a
 * `score` on an ordered rubric. Every answer carries probabilities.
 *
 * `decide()` follows the shape of `embed()`: payload first, config last,
 * provider and key and base URL resolved through the shared helpers. There
 * is one provider, `typesafe`, which is the wire protocol. A Laya server
 * speaks the same protocol, so it is reached by setting `baseUrl.typesafe`.
 */
import { z } from "zod";
import type { ModelDataBlob } from "./modelData.js";
import { Result, success, failure } from "./types/result.js";
import { TokenUsage } from "./types/tokenUsage.js";
import { CostEstimate } from "./types/costEstimate.js";
import { resolveProvider, resolveApiKey, resolveBaseUrl } from "./util/provider.js";
import { isDecisionModel, resolveModelForProvider, type DecisionModel } from "./models.js";
import { round } from "./util/util.js";

export const DECISION_PROVIDER = "typesafe";

export type NoulQuestion = {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
};

export type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  /** Option key to its description. */
  criteria: Record<string, string>;
};

export type ScoreQuestion = {
  type: "score";
  instructions: string;
  /** Ordered level descriptions, lowest first. At least two. */
  criteria: string[];
};

export type DecisionQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export type NoulAnswer = {
  type: "noul";
  /** Probability that the answer is yes, 0 to 1. */
  noul: number;
};

export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  confidence: number;
  /** Option key to probability. */
  probabilities: Record<string, number>;
};

export type ScoreAnswer = {
  type: "score";
  /** Expected level. May be fractional. */
  score: number;
  confidence: number;
  /** Level index to description. */
  legend: Record<string, string>;
  /** Level index to probability. */
  probabilities: Record<string, number>;
};

export type DecisionAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

/** What the model reads before answering: text, or a JSON value. */
export type DecisionState = string | object;

export type DecideConfig = {
  model: string;
  /** Required when the model is not in the registry. */
  provider?: string;

  /** API keys, nested by provider. Falls back to TYPESAFE_API_KEY. */
  apiKey?: {
    typesafe?: string;
    [provider: string]: string | undefined;
  };

  /** Custom base URLs, nested by provider. Falls back to TYPESAFE_BASE_URL,
   *  then TypeSafe's host. Point `typesafe` at a Laya server to use Laya. */
  baseUrl?: {
    typesafe?: string;
    [provider: string]: string | undefined;
  };

  /** Refreshed model data to layer over the baked-in registry. */
  modelData?: ModelDataBlob;

  abortSignal?: AbortSignal;
};

export type DecideResult = {
  answers: Record<string, DecisionAnswer>;
  usage: TokenUsage;
  cost?: CostEstimate;
  /** The versioned model the server reports, e.g. `jev-1.13`. */
  model: string;
};

const NoulAnswerSchema = z.object({
  type: z.literal("noul"),
  noul: z.number(),
});

const ChoiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  confidence: z.number(),
  probabilities: z.record(z.string(), z.number()),
});

const ScoreAnswerSchema = z.object({
  type: z.literal("score"),
  score: z.number(),
  confidence: z.number(),
  legend: z.record(z.string(), z.string()),
  probabilities: z.record(z.string(), z.number()),
});

const DecisionAnswerSchema = z.discriminatedUnion("type", [
  NoulAnswerSchema,
  ChoiceAnswerSchema,
  ScoreAnswerSchema,
]);

const ResponseSchema = z.object({
  model: z.string().optional(),
  answers: z.record(z.string(), DecisionAnswerSchema),
  usage: z
    .object({
      input_tokens: z.number(),
      output_tokens: z.number().optional(),
    })
    .optional(),
});

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/** A problem with the questions that no server would accept. Checked before
 *  any request so a bad question map never costs a round trip. */
function checkQuestions(
  questions: Record<string, DecisionQuestion>,
  maxQuestions: number | undefined,
): string | undefined {
  const names = Object.keys(questions);
  if (names.length === 0) {
    return "No questions given. A decision request needs at least one question.";
  }
  if (maxQuestions !== undefined && names.length > maxQuestions) {
    return `Too many questions: ${names.length} given, the model accepts at most ${maxQuestions} per request.`;
  }
  for (const name of names) {
    const q = questions[name];
    if (q.type === "choice" && Object.keys(q.criteria).length < 2) {
      return `Question "${name}" is a choice with fewer than two options.`;
    }
    if (q.type === "score" && q.criteria.length < 2) {
      return `Question "${name}" is a score with fewer than two levels.`;
    }
  }
  return undefined;
}

function isProbability(n: number): boolean {
  return n >= 0 && n <= 1;
}

/** A response that parsed but does not answer what was asked. The Zod
 *  schema only says each field is a number or a string; this checks the
 *  numbers are probabilities and the answer fits the question it is for. */
function checkAnswers(
  questions: Record<string, DecisionQuestion>,
  answers: Record<string, DecisionAnswer>,
): string | undefined {
  for (const name of Object.keys(questions)) {
    const q = questions[name];
    const a = answers[name];
    if (a === undefined) {
      return `The response has no answer for question "${name}".`;
    }
    if (a.type !== q.type) {
      return `Question "${name}" is a ${q.type} but the answer is a ${a.type}.`;
    }
    if (a.type === "noul" && !isProbability(a.noul)) {
      return `Question "${name}" has a noul of ${a.noul}, which is not between 0 and 1.`;
    }
    if ((a.type === "choice" || a.type === "score") && !isProbability(a.confidence)) {
      return `Question "${name}" has a confidence of ${a.confidence}, which is not between 0 and 1.`;
    }
    if (q.type === "choice" && a.type === "choice") {
      if (!(a.choice in q.criteria)) {
        return `Question "${name}" answered "${a.choice}", which is not one of its options.`;
      }
      const unknown = Object.keys(a.probabilities).find((k) => !(k in q.criteria));
      if (unknown !== undefined) {
        return `Question "${name}" has a probability for "${unknown}", which is not one of its options.`;
      }
    }
    if (q.type === "score" && a.type === "score") {
      const levels = q.criteria.length;
      if (Object.keys(a.legend).length !== levels) {
        return `Question "${name}" has ${levels} levels but the answer's legend has ${Object.keys(a.legend).length}.`;
      }
      if (Object.keys(a.probabilities).length !== levels) {
        return `Question "${name}" has ${levels} levels but the answer has ${Object.keys(a.probabilities).length} probabilities.`;
      }
      if (a.score < 0 || a.score > levels - 1) {
        return `Question "${name}" has a score of ${a.score}, outside its ${levels} levels.`;
      }
    }
  }
  return undefined;
}

function calculateDecisionCost(
  model: DecisionModel | undefined,
  inputTokens: number,
): CostEstimate | undefined {
  if (model === undefined || model.inputTokenCost === undefined) {
    return undefined;
  }
  const inputCost = round((inputTokens * model.inputTokenCost) / 1_000_000, 6);
  return { inputCost, outputCost: 0, totalCost: inputCost, currency: "USD" };
}

/**
 * Ask a decision model one or more typed questions about a state.
 *
 * ```ts
 * const r = await decide(ticket, {
 *   department: { type: "choice", instructions: "Which team?", criteria: { billing: "refunds", support: "bugs" } },
 *   churn: { type: "noul", instructions: "Likely to cancel?" },
 * }, { model: "jev-latest" });
 * ```
 *
 * Cost is priced from the registry entry of the **requested** model, so a
 * model the registry does not know, such as a Laya checkpoint, has no cost.
 */
export async function decide(
  state: DecisionState,
  questions: Record<string, DecisionQuestion>,
  config: DecideConfig,
): Promise<Result<DecideResult>> {
  let provider: string;
  try {
    provider = resolveProvider(config.model, config.provider, config.modelData);
  } catch (err) {
    return failure(errorMessage(err));
  }
  if (provider !== DECISION_PROVIDER) {
    return failure(
      `Provider "${provider}" does not answer decisions. Only "${DECISION_PROVIDER}" does; set config.provider to it for a model the registry does not know.`,
    );
  }

  // The registry entry for the requested name, when there is one. It sets
  // the question cap and the price. A Laya model has no entry and no price.
  const found = resolveModelForProvider(provider, config.model, config.modelData);
  const registryModel = found && isDecisionModel(found) ? found : undefined;
  const questionProblem = checkQuestions(questions, registryModel?.maxQuestions);
  if (questionProblem) {
    return failure(questionProblem);
  }

  const apiKey = resolveApiKey(provider, config);
  if (!apiKey) {
    return failure(
      "No TypeSafe API key provided. Set config.apiKey.typesafe or the TYPESAFE_API_KEY environment variable.",
    );
  }
  const baseUrl = resolveBaseUrl(provider, config)!.replace(/\/+$/, "");

  if (config.abortSignal?.aborted) {
    return failure("Request was aborted");
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/v1/systemone`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: config.model, state, questions }),
      signal: config.abortSignal,
    });
  } catch (err) {
    if (config.abortSignal?.aborted) {
      return failure("Request was aborted");
    }
    return failure(`Decision request failed: ${errorMessage(err)}`);
  }

  const text = await response.text();
  if (!response.ok) {
    return failure(`Decision request failed with status ${response.status}: ${text}`, {
      status: response.status,
    });
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return failure(`Decision response is not JSON: ${text.slice(0, 200)}`);
  }
  const parsed = ResponseSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
    return failure(`Decision response has an unexpected shape${where}: ${issue.message}`);
  }

  const answers = parsed.data.answers as Record<string, DecisionAnswer>;
  const answerProblem = checkAnswers(questions, answers);
  if (answerProblem) {
    return failure(answerProblem);
  }

  // Output is free, so only input tokens are priced. The server's output
  // count is still reported: Jev sends 0, but a gateway may count its own.
  const inputTokens = parsed.data.usage?.input_tokens ?? 0;
  const outputTokens = parsed.data.usage?.output_tokens ?? 0;
  return success({
    answers,
    usage: { inputTokens, outputTokens },
    cost: calculateDecisionCost(registryModel, inputTokens),
    model: parsed.data.model ?? config.model,
  });
}
