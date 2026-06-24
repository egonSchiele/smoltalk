export interface SmolErrorOptions {
  /** HTTP status code from the provider response, when the error came from an HTTP call. */
  status?: number;
  /** HTTP response headers from the provider response, when available. */
  headers?: Record<string, string>;
  /**
   * Suggested wait before retrying, in milliseconds, parsed from the
   * `retry-after-ms` / `retry-after` response headers (when available).
   */
  retryAfterMs?: number;
  /** The underlying error this was derived from, if any. */
  cause?: unknown;
}

export class SmolError extends Error {
  /** HTTP status code from the provider response, when available. */
  readonly status?: number;
  /** HTTP response headers from the provider response, when available. */
  readonly headers?: Record<string, string>;
  /**
   * Suggested wait before retrying, in milliseconds, parsed from the
   * `retry-after-ms` / `retry-after` response headers (when available).
   */
  readonly retryAfterMs?: number;

  constructor(message: string, options: SmolErrorOptions = {}) {
    super(message);
    this.name = "SmolTalkError";
    this.status = options.status;
    this.headers = options.headers;
    this.retryAfterMs = options.retryAfterMs;
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
