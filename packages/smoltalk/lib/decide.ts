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
 * provider and key and base URL resolved through the shared helpers. It picks
 * a provider function: a built-in one first, then one added with
 * registerDecisionProvider. Every built-in provider that speaks the System
 * One format (`typesafe`, `openrouter`) is a row of SYSTEMONE_SERVERS in
 * `lib/decide/systemone.ts` and shares systemoneDecide. A Laya server speaks
 * the same format, so it is reached by setting `baseUrl.typesafe`.
 *
 * The question check, the answer check, and the cost live here, so every
 * provider, built in or registered, gets them.
 */
import type { ModelDataBlob } from "./modelData.js";
import { Result, success, failure } from "./types/result.js";
import { TokenUsage } from "./types/tokenUsage.js";
import { CostEstimate } from "./types/costEstimate.js";
import { resolveProvider } from "./util/provider.js";
import { getDecisionModelForProvider, type DecisionModel } from "./models.js";
import { errorMessage, round } from "./util/util.js";
import { SYSTEMONE_SERVERS, systemoneDecide } from "./decide/systemone.js";

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

/** `confidence` and `probabilities` may be absent: some models leave them
 *  out. */
export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  confidence?: number;
  /** Option key to probability. */
  probabilities?: Record<string, number>;
};

/** `confidence`, `legend`, and `probabilities` may be absent: some models
 *  leave them out. */
export type ScoreAnswer = {
  type: "score";
  /** Expected level. May be fractional. */
  score: number;
  confidence?: number;
  /** Level index to description. */
  legend?: Record<string, string>;
  /** Level index to probability. */
  probabilities?: Record<string, number>;
};

export type DecisionAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

/** What the model reads before answering: text, or a JSON value. */
export type DecisionState = string | object;

export type DecideConfig = {
  model: string;
  /** Required when the model is not in the registry. */
  provider?: string;

  /** API keys, nested by provider. Falls back to TYPESAFE_API_KEY or OPENROUTER_API_KEY. */
  apiKey?: {
    typesafe?: string;
    openRouter?: string;
    [provider: string]: string | undefined;
  };

  /** Custom base URLs, nested by provider. TypeSafe falls back to TYPESAFE_BASE_URL,
   *  then its host. OpenRouter defaults to https://openrouter.ai/api/v1.
   *  Point `typesafe` at a Laya server to use Laya. */
  baseUrl?: {
    typesafe?: string;
    openRouter?: string;
    [provider: string]: string | undefined;
  };

  /** Refreshed model data to layer over the baked-in registry. */
  modelData?: ModelDataBlob;

  abortSignal?: AbortSignal;

  // Plugin support
  metadata?: Record<string, unknown>;
};

/** What a provider function returns: the parsed answers, the token counts,
 *  and the model name the server reported. `decide()` checks the answers
 *  and prices the call, so a provider does neither. */
export type DecideProviderReply = {
  answers: Record<string, DecisionAnswer>;
  usage: TokenUsage;
  /** The model name the server reported, if it sent one. */
  model?: string;
};

export type DecideResult = {
  answers: Record<string, DecisionAnswer>;
  usage: TokenUsage;
  cost?: CostEstimate;
  /** The versioned model the server reports, e.g. `jev-1.13`. */
  model: string;
};

/** A function that answers decisions for one provider. It sends the request
 *  and returns the parsed answers; `decide()` checks the questions before
 *  calling it, then checks the answers and prices the call. `config.provider`
 *  is the resolved provider name. */
export type DecideProvider = (
  state: DecisionState,
  questions: Record<string, DecisionQuestion>,
  config: DecideConfig,
) => Promise<Result<DecideProviderReply>>;

// Null-prototype so provider names like "toString"/"__proto__" can't collide
// with Object.prototype or pollute the registry.
const registeredDecideProviders: Record<string, DecideProvider> =
  Object.create(null);

/** Add a decision provider under `name`. Built-in providers win: a
 *  registration under a built-in name such as `typesafe` or `openrouter` is
 *  stored but never called, even though hasDecisionProvider reports it. */
export function registerDecisionProvider(name: string, fn: DecideProvider): void {
  registeredDecideProviders[name] = fn;
}

/** True when `name` has a decision provider registered through
 *  registerDecisionProvider. The built-in providers are not its concern,
 *  the same as hasEmbeddingProvider. */
export function hasDecisionProvider(name: string): boolean {
  return name in registeredDecideProviders;
}

export function unregisterDecisionProvider(name: string): boolean {
  if (name in registeredDecideProviders) {
    delete registeredDecideProviders[name];
    return true;
  }
  return false;
}

/** The built-in provider function for a name, if there is one. */
function builtInProvider(provider: string): DecideProvider | undefined {
  if (Object.hasOwn(SYSTEMONE_SERVERS, provider)) {
    return systemoneDecide;
  }
  return undefined;
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
    if (
      (a.type === "choice" || a.type === "score") &&
      a.confidence !== undefined &&
      !isProbability(a.confidence)
    ) {
      return `Question "${name}" has a confidence of ${a.confidence}, which is not between 0 and 1.`;
    }
    if (q.type === "choice" && a.type === "choice") {
      if (!(a.choice in q.criteria)) {
        return `Question "${name}" answered "${a.choice}", which is not one of its options.`;
      }
      if (a.probabilities !== undefined) {
        const unknown = Object.keys(a.probabilities).find((k) => !(k in q.criteria));
        if (unknown !== undefined) {
          return `Question "${name}" has a probability for "${unknown}", which is not one of its options.`;
        }
      }
    }
    if (q.type === "score" && a.type === "score") {
      const levels = q.criteria.length;
      if (a.legend !== undefined && Object.keys(a.legend).length !== levels) {
        return `Question "${name}" has ${levels} levels but the answer's legend has ${Object.keys(a.legend).length}.`;
      }
      if (a.probabilities !== undefined && Object.keys(a.probabilities).length !== levels) {
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

  let providerFn = builtInProvider(provider);
  if (providerFn === undefined) {
    providerFn = registeredDecideProviders[provider];
  }
  if (providerFn === undefined) {
    const builtIns = Object.keys(SYSTEMONE_SERVERS).join(", ");
    return failure(
      `Provider "${provider}" does not answer decisions. Use one of: ${builtIns}, or register one with registerDecisionProvider(name, fn).`,
    );
  }

  // The registry entry for the requested name, when there is one. It sets
  // the question cap and the price. A Laya model has no entry and no price.
  const registryModel = getDecisionModelForProvider(provider, config.model, config.modelData);
  const questionProblem = checkQuestions(questions, registryModel?.maxQuestions);
  if (questionProblem) {
    return failure(questionProblem);
  }

  const reply = await providerFn(state, questions, { ...config, provider });
  if (!reply.success) {
    return reply;
  }

  const answers = reply.value.answers;
  const answerProblem = checkAnswers(questions, answers);
  if (answerProblem) {
    return failure(answerProblem);
  }

  return success({
    answers,
    usage: reply.value.usage,
    cost: calculateDecisionCost(registryModel, reply.value.usage.inputTokens),
    model: reply.value.model ?? config.model,
  });
}
