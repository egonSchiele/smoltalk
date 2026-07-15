import type { StopReason } from "../types/stopReason.js";

/**
 * Pure mappers from each provider's raw finish/stop-reason vocabulary to the
 * unified {@link StopReason}. Clients set `PromptResult.stopReason` from these
 * and keep the untouched provider value in `PromptResult.rawStopReason`.
 */

const OPENAI_MAP: Record<string, StopReason> = {
  stop: "stop",
  length: "length",
  tool_calls: "tool_use",
  function_call: "tool_use",
  content_filter: "content_filter",
};

export function normalizeOpenAIStopReason(
  raw: string | null | undefined,
): StopReason {
  return (raw && OPENAI_MAP[raw]) || "other";
}

const ANTHROPIC_MAP: Record<string, StopReason> = {
  end_turn: "stop",
  max_tokens: "length",
  tool_use: "tool_use",
  stop_sequence: "stop_sequence",
  refusal: "content_filter",
  pause_turn: "pause",
};

export function normalizeAnthropicStopReason(
  raw: string | null | undefined,
): StopReason {
  return (raw && ANTHROPIC_MAP[raw]) || "other";
}

const GOOGLE_MAP: Record<string, StopReason> = {
  STOP: "stop",
  MAX_TOKENS: "length",
  SAFETY: "content_filter",
  PROHIBITED_CONTENT: "content_filter",
  RECITATION: "content_filter",
  BLOCKLIST: "content_filter",
  SPII: "content_filter",
};

export function normalizeGoogleStopReason(
  raw: string | null | undefined,
  hasToolCalls: boolean,
): StopReason {
  // Gemini reports `STOP` even for tool-call turns, so infer `tool_use` when
  // tool calls are present — otherwise the unified field couldn't detect tool
  // use on Google the way it does on OpenAI/Anthropic.
  if (raw === "STOP" && hasToolCalls) {
    return "tool_use";
  }
  return (raw && GOOGLE_MAP[raw]) || "other";
}

const OLLAMA_MAP: Record<string, StopReason> = {
  stop: "stop",
  length: "length",
};

export function normalizeOllamaStopReason(
  raw: string | null | undefined,
): StopReason {
  return (raw && OLLAMA_MAP[raw]) || "other";
}

const RESPONSES_INCOMPLETE_MAP: Record<string, StopReason> = {
  max_output_tokens: "length",
  content_filter: "content_filter",
};

/**
 * The Responses API has no single finish-reason field: a `completed` response
 * is a normal stop (or tool use, if it carries tool calls), while an
 * `incomplete` one carries the reason in `incomplete_details.reason`.
 */
export function normalizeOpenAIResponsesStopReason(
  status: string | null | undefined,
  incompleteReason: string | null | undefined,
  hasToolCalls: boolean,
): StopReason {
  if (incompleteReason) {
    return RESPONSES_INCOMPLETE_MAP[incompleteReason] || "other";
  }
  if (status === "completed") {
    return hasToolCalls ? "tool_use" : "stop";
  }
  return "other";
}
