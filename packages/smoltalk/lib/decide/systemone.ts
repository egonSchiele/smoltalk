/**
 * The System One wire format: TypeSafe's name for the request Jev
 * introduced, served at a `/systemone` route. TypeSafe, OpenRouter, Laya's
 * server, llama.cpp's server, and Cloudflare's Clef all speak it, so every
 * built-in provider that does is a row in SYSTEMONE_SERVERS and shares
 * systemoneDecide.
 */
import { z } from "zod";
import type {
  DecideConfig,
  DecideProviderReply,
  DecisionAnswer,
  DecisionQuestion,
  DecisionState,
} from "../decide.js";
import { Result, success, failure } from "../types/result.js";
import { resolveApiKey, resolveBaseUrl } from "../util/provider.js";
import { errorMessage } from "../util/util.js";

/** One server that speaks the System One format. */
export type SystemoneServer = {
  /** Appended to the provider's base URL. */
  path: string;
  /** The failure sent back when the key is missing, e.g.
   *  "No TypeSafe API key provided. Set config.apiKey.typesafe or the
   *  TYPESAFE_API_KEY environment variable."
   *  Leave it out for a server that needs no key. */
  missingKeyMessage?: string;
};

/** Every built-in provider that speaks the System One format. Adding a
 *  server that speaks it is one row here, plus its key and base URL in
 *  `lib/util/provider.ts`. Look rows up with Object.hasOwn: this is a plain
 *  object, so `"toString" in SYSTEMONE_SERVERS` is true. */
export const SYSTEMONE_SERVERS: Record<string, SystemoneServer> = {
  typesafe: {
    path: "/v1/systemone",
    missingKeyMessage:
      "No TypeSafe API key provided. Set config.apiKey.typesafe or the TYPESAFE_API_KEY environment variable.",
  },
  openrouter: {
    path: "/systemone",
    missingKeyMessage:
      "No OpenRouter API key provided. Set config.apiKey.openRouter or the OPENROUTER_API_KEY environment variable.",
  },
};

const NoulAnswerSchema = z.object({
  type: z.literal("noul"),
  noul: z.number(),
});

// confidence, probabilities, and legend may be absent, depending on the
// model (OpenRouter's reference for this route says so).
const ChoiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  confidence: z.number().optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
});

const ScoreAnswerSchema = z.object({
  type: z.literal("score"),
  score: z.number(),
  confidence: z.number().optional(),
  legend: z.record(z.string(), z.string()).optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
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

/**
 * Ask a System One server. `config.provider` names the row in
 * SYSTEMONE_SERVERS; `decide()` fills it in with the resolved provider.
 *
 * The key rule: no key and the row has a `missingKeyMessage` fails with that
 * message; no key and the row has none sends no Authorization header; a key
 * is always sent as a bearer token.
 */
export async function systemoneDecide(
  state: DecisionState,
  questions: Record<string, DecisionQuestion>,
  config: DecideConfig,
): Promise<Result<DecideProviderReply>> {
  const provider = config.provider ?? "";
  if (!Object.hasOwn(SYSTEMONE_SERVERS, provider)) {
    return failure(`Provider "${provider}" does not speak the System One format.`);
  }
  const server = SYSTEMONE_SERVERS[provider];

  const apiKey = resolveApiKey(provider, config);
  if (!apiKey && server.missingKeyMessage !== undefined) {
    return failure(server.missingKeyMessage);
  }
  const baseUrl = resolveBaseUrl(provider, config)!.replace(/\/+$/, "");
  const endpoint = `${baseUrl}${server.path}`;

  if (config.abortSignal?.aborted) {
    return failure("Request was aborted");
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
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

  // Output is free, so only input tokens are priced. The server's output
  // count is still reported: Jev sends 0, but a gateway may count its own.
  const reply: DecideProviderReply = {
    answers: parsed.data.answers as Record<string, DecisionAnswer>,
    usage: {
      inputTokens: parsed.data.usage?.input_tokens ?? 0,
      outputTokens: parsed.data.usage?.output_tokens ?? 0,
    },
  };
  if (parsed.data.model !== undefined) {
    reply.model = parsed.data.model;
  }
  return success(reply);
}
