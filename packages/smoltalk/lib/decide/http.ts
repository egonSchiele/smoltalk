import type { z } from "zod";
import { Result, success, failure, type Failure } from "../types/result.js";
import { errorMessage } from "../util/errorMessage.js";

export type DecisionRequest = {
  endpoint: string;
  /** Omitted for a server that takes no key. */
  apiKey?: string;
  body: unknown;
  signal?: AbortSignal;
};

/** POST a decision request and return the parsed JSON reply. Every
 *  failure a decision provider can have before it reads the reply is
 *  made here: an aborted call, a network error, a non-2xx status
 *  (carried as `status`), and a reply that is not JSON. */
export async function postDecisionRequest(request: DecisionRequest): Promise<Result<unknown>> {
  if (request.signal?.aborted) {
    return failure("Request was aborted");
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (request.apiKey) {
    headers.Authorization = `Bearer ${request.apiKey}`;
  }

  let response: Response;
  try {
    response = await fetch(request.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(request.body),
      signal: request.signal,
    });
  } catch (err) {
    if (request.signal?.aborted) {
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

  try {
    return success(JSON.parse(text) as unknown);
  } catch {
    return failure(`Decision response is not JSON: ${text.slice(0, 200)}`);
  }
}

/** The failure for a reply that parsed as JSON but does not match the
 *  provider's schema. Every decision provider uses this wording. */
export function shapeFailure(error: z.ZodError): Failure {
  const issue = error.issues[0];
  let where = "";
  if (issue.path.length > 0) {
    where = ` at ${issue.path.join(".")}`;
  }
  return failure(`Decision response has an unexpected shape${where}: ${issue.message}`);
}
