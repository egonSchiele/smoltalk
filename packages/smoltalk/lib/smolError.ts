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

/**
 * Base error type for all smoltalk failures. Carries a curated, safe-to-log
 * snapshot of the HTTP response on `status` / `headers` / `retryAfterMs` /
 * `requestId`.
 *
 * **Security note on `cause`:** the raw provider error is attached at `cause`
 * as a non-enumerable property (using the ES2022 `Error` `{ cause }` option),
 * so `JSON.stringify(err)` and most error serializers (Sentry, pino, Bunyan)
 * will NOT walk it. The custom `toJSON()` below similarly omits both `cause`
 * and `stack`. The provider error can still contain `authorization` headers,
 * cookies, and echoed prompt bodies — direct access (`err.cause`) and Node's
 * native `console.error` chain still work, so handle deliberately.
 */
export class SmolError extends Error {
  /** HTTP status code from the provider response, when available. */
  readonly status?: number;
  /**
   * Curated, safe-to-log subset of the provider response headers. For the full,
   * unredacted set (including any session cookies the provider sent), reach for
   * the raw provider error on `cause` — but note that `cause` is non-enumerable
   * specifically to keep it out of casual logging.
   */
  readonly headers?: Record<string, string>;
  /**
   * Suggested wait before retrying, in milliseconds, parsed from the
   * `retry-after-ms` / `retry-after` response headers (when available).
   * Always non-negative and capped at a sane ceiling (see `httpError.ts`).
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
      // Explicit non-enumerable install. A plain `this.cause = options.cause`
      // would create an *enumerable* own property — `JSON.stringify(err)` and
      // structured loggers (`logger.error({ err })`) would then walk `cause`
      // and re-leak the raw provider error (including the unredacted
      // `set-cookie` / `authorization` headers the allowlist stripped from
      // `headers`). This restores the behavior the spec intends for
      // `new Error(msg, { cause })`: `cause` is the escape hatch, not the
      // default-serialized field.
      Object.defineProperty(this, "cause", {
        value: options.cause,
        enumerable: false,
        writable: true,
        configurable: true,
      });
    }
  }

  /**
   * Custom JSON serializer. Returns only the curated/safe fields — never
   * `cause` or `stack`, both of which can leak secrets (auth headers in
   * `cause`, file system paths and source snippets in `stack`).
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      headers: this.headers,
      retryAfterMs: this.retryAfterMs,
      requestId: this.requestId,
    };
  }

  /**
   * Custom Node.js inspect. Node's default error formatter walks `cause` and
   * prints it even when the property is non-enumerable, which would re-leak
   * the raw provider error through `console.error(err)` / `util.inspect(err)`.
   * Override that path to show a placeholder; callers who want the full chain
   * can still reach for `err.cause` explicitly.
   */
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    const fields: string[] = [`${this.name}: ${this.message}`];
    if (this.status !== undefined) fields.push(`status: ${this.status}`);
    if (this.requestId !== undefined)
      fields.push(`requestId: ${JSON.stringify(this.requestId)}`);
    if (this.retryAfterMs !== undefined)
      fields.push(`retryAfterMs: ${this.retryAfterMs}`);
    if (this.headers !== undefined)
      fields.push(`headers: ${JSON.stringify(this.headers)}`);
    if (this.cause !== undefined)
      fields.push("cause: [hidden — access err.cause directly]");
    return fields.join("\n  ");
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
