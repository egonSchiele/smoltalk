export interface SmolErrorOptions {
  /** HTTP status code from the provider response, when the error came from an HTTP call. */
  status?: number;
  /**
   * Curated, safe-to-log subset of the provider response headers (see
   * `extractHttpErrorFields` for the allowlist). The full, unredacted headers
   * live on the raw provider error at `cause`.
   */
  headers?: Record<string, string>;
  /**
   * Suggested wait before retrying, in milliseconds, parsed from the
   * `retry-after-ms` / `retry-after` response headers (when available).
   */
  retryAfterMs?: number;
  /** Provider request id (`x-request-id` / `request-id`), useful for support tickets. */
  requestId?: string;
  /** The underlying provider error this was derived from, if any. */
  cause?: unknown;
}

export class SmolError extends Error {
  /** HTTP status code from the provider response, when available. */
  readonly status?: number;
  /**
   * Curated, safe-to-log subset of the provider response headers. For the full,
   * unredacted set (including any session cookies the provider sent), reach for
   * the raw provider error on `cause`.
   */
  readonly headers?: Record<string, string>;
  /**
   * Suggested wait before retrying, in milliseconds, parsed from the
   * `retry-after-ms` / `retry-after` response headers (when available).
   */
  readonly retryAfterMs?: number;
  /** Provider request id (`x-request-id` / `request-id`), useful for support tickets. */
  readonly requestId?: string;

  constructor(message: string, options: SmolErrorOptions = {}) {
    super(message);
    this.name = "SmolTalkError";
    this.status = options.status;
    this.headers = options.headers;
    this.retryAfterMs = options.retryAfterMs;
    this.requestId = options.requestId;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export class SmolStructuredOutputError extends SmolError {
  constructor(message: string, options: SmolErrorOptions = {}) {
    super(message, options);
    this.name = "SmolStructuredOutputError";
  }
}

export class SmolTimeoutError extends SmolError {
  constructor(message: string, options: SmolErrorOptions = {}) {
    super(message, options);
    this.name = "SmolTimeoutError";
  }
}

export class SmolContentPolicyError extends SmolError {
  constructor(message: string, options: SmolErrorOptions = {}) {
    super(message, options);
    this.name = "SmolContentPolicyError";
  }
}

export class SmolContextWindowExceededError extends SmolError {
  constructor(message: string, options: SmolErrorOptions = {}) {
    super(message, options);
    this.name = "SmolContextWindowExceededError";
  }
}

/** Rate limited (HTTP 429). Inspect `retryAfterMs` to back off. */
export class SmolRateLimitError extends SmolError {
  constructor(message: string, options: SmolErrorOptions = {}) {
    super(message, options);
    this.name = "SmolRateLimitError";
  }
}

/** Provider temporarily overloaded/unavailable (HTTP 503, or Anthropic's 529). */
export class SmolOverloadedError extends SmolError {
  constructor(message: string, options: SmolErrorOptions = {}) {
    super(message, options);
    this.name = "SmolOverloadedError";
  }
}

/** Authentication or permission failure (HTTP 401/403). */
export class SmolAuthError extends SmolError {
  constructor(message: string, options: SmolErrorOptions = {}) {
    super(message, options);
    this.name = "SmolAuthError";
  }
}

/**
 * Pick the most specific SmolError subclass for an HTTP status code, so retry
 * code can `instanceof`-dispatch instead of sniffing magic status numbers.
 * Falls back to the base `SmolError` for unclassified statuses.
 */
export function smolErrorForStatus(
  message: string,
  options: SmolErrorOptions = {},
): SmolError {
  const status = options.status;
  if (status === 429) {
    return new SmolRateLimitError(message, options);
  }
  if (status === 503 || status === 529) {
    return new SmolOverloadedError(message, options);
  }
  if (status === 401 || status === 403) {
    return new SmolAuthError(message, options);
  }
  return new SmolError(message, options);
}
