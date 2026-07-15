/**
 * Normalized reason a generation turn ended, unified across providers. The
 * untouched provider value is available separately as `PromptResult.rawStopReason`.
 */
export type StopReason =
  /** Natural completion (OpenAI `stop`, Anthropic `end_turn`, Google `STOP`, Ollama `stop`). */
  | "stop"
  /** Hit the max-tokens limit (`length` / `max_tokens` / `MAX_TOKENS`). */
  | "length"
  /** Model wants to call a tool (`tool_calls` / `tool_use`). */
  | "tool_use"
  /** Blocked by a safety/policy filter or refusal (`content_filter` / `refusal` / `SAFETY`). */
  | "content_filter"
  /** Hit a caller-supplied stop sequence (Anthropic `stop_sequence`). */
  | "stop_sequence"
  /** Provider paused a long-running turn (Anthropic `pause_turn`). */
  | "pause"
  /** Anything unmapped or unknown. */
  | "other";
