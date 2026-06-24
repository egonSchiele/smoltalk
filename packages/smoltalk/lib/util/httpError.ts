/**
 * Best-effort extraction of HTTP status and headers from a provider SDK error.
 *
 * Each provider SDK shapes its errors slightly differently:
 * - OpenAI / Anthropic: `status` (number) + `headers` (web `Headers`)
 * - Google Gemini (`@google/genai`): `status` (number), no headers
 * - Ollama: `status_code` (number), no headers
 */
export interface HttpErrorFields {
  status?: number;
  /** Allowlisted, safe-to-log subset of response headers (see `ALLOWED_HEADERS`). */
  headers?: Record<string, string>;
  /**
   * Suggested wait before retrying, in milliseconds, parsed from the
   * `retry-after-ms` / `retry-after` response headers. Only ever populated for
   * OpenAI/Anthropic — Google and Ollama errors carry no headers to parse.
   * Always non-negative and capped at `MAX_RETRY_AFTER_MS`.
   */
  retryAfterMs?: number;
  /** Provider request id (`x-request-id` / `request-id`), useful for support tickets. */
  requestId?: string;
}

/**
 * Explicit allowlist (not denylist, not prefix-wildcard). smoltalk can be
 * pointed at proxies (LiteLLM, OpenRouter) that re-emit upstream headers
 * verbatim, and some APIs echo credentials back on errors — a denylist would
 * pass `authorization`, `x-api-key`, forwarded `llm_provider-*` headers, etc.
 * (cf. Traefik GHSA-p6hg-qh38-555r). A prefix wildcard like `x-ratelimit-*`
 * is safer than a denylist but still risks absorbing a future
 * `x-ratelimit-organization` style header that carries an identifier or
 * secret. Capture only known-safe headers with diagnostic value; the raw
 * provider error is reachable on `SmolError.cause` (non-enumerable) as the
 * escape hatch for callers that explicitly opt in.
 */
const ALLOWED_HEADERS = new Set<string>([
  // Retry hints
  "retry-after",
  "retry-after-ms",
  // Request correlation
  "request-id",
  "x-request-id",
  // Diagnostic
  "content-type",
  // OpenAI rate-limit family (exhaustive as of writing — new headers added
  // by providers must be added explicitly here).
  "x-ratelimit-limit-requests",
  "x-ratelimit-limit-tokens",
  "x-ratelimit-remaining-requests",
  "x-ratelimit-remaining-tokens",
  "x-ratelimit-reset-requests",
  "x-ratelimit-reset-tokens",
  // Anthropic rate-limit family
  "anthropic-ratelimit-requests-limit",
  "anthropic-ratelimit-requests-remaining",
  "anthropic-ratelimit-requests-reset",
  "anthropic-ratelimit-tokens-limit",
  "anthropic-ratelimit-tokens-remaining",
  "anthropic-ratelimit-tokens-reset",
  "anthropic-ratelimit-input-tokens-limit",
  "anthropic-ratelimit-input-tokens-remaining",
  "anthropic-ratelimit-input-tokens-reset",
  "anthropic-ratelimit-output-tokens-limit",
  "anthropic-ratelimit-output-tokens-remaining",
  "anthropic-ratelimit-output-tokens-reset",
]);

function isAllowedHeader(name: string): boolean {
  return ALLOWED_HEADERS.has(name.toLowerCase());
}

/**
 * Upper bound on `retryAfterMs`. Anything longer is almost certainly a
 * misparsed HTTP-date or a hostile/buggy proxy injecting a far-future value
 * (e.g. `Sat, 01 Jan 9999 …`). 5 minutes is well beyond any sane provider
 * rate-limit window — callers that wanted to wait longer would have given
 * up by then anyway.
 */
const MAX_RETRY_AFTER_MS = 5 * 60 * 1000;

function clampRetryAfter(ms: number): number {
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, Math.round(ms)));
}

/**
 * Read a property without letting a throwing accessor break the whole
 * extraction. Some error shapes (especially JSON-parsed bodies that bubble
 * up as errors) can carry getters that throw or have side effects.
 */
function safeGet(obj: Record<string, unknown>, key: string): unknown {
  try {
    return obj[key];
  } catch {
    return undefined;
  }
}

export function extractHttpErrorFields(error: unknown): HttpErrorFields {
  const fields: HttpErrorFields = {};
  if (!error || typeof error !== "object") {
    return fields;
  }

  const err = error as Record<string, unknown>;

  const status =
    safeGet(err, "status") ??
    safeGet(err, "statusCode") ??
    safeGet(err, "status_code");
  if (typeof status === "number") {
    fields.status = status;
  }

  const headers = normalizeHeaders(safeGet(err, "headers"));
  if (headers) {
    fields.headers = headers;
    const retryAfterMs = parseRetryAfterMs(headers);
    if (retryAfterMs !== undefined) {
      fields.retryAfterMs = retryAfterMs;
    }
  }

  const requestId = extractRequestId(err, headers);
  if (requestId !== undefined) {
    fields.requestId = requestId;
  }

  return fields;
}

function extractRequestId(
  err: Record<string, unknown>,
  headers: Record<string, string> | undefined,
): string | undefined {
  // The OpenAI/Anthropic SDK errors carry a parsed request id directly.
  // NOTE: providers may embed account/org identifiers in request ids (e.g.
  // OpenAI's `req_<orghash>_<reqhash>`). These are loggable but not entirely
  // opaque — keep that in mind when forwarding to third-party telemetry.
  const requestID = safeGet(err, "requestID");
  if (typeof requestID === "string") {
    return requestID;
  }
  const request_id = safeGet(err, "request_id");
  if (typeof request_id === "string") {
    return request_id;
  }
  if (headers) {
    return (
      headerValue(headers, "x-request-id") ?? headerValue(headers, "request-id")
    );
  }
  return undefined;
}

function normalizeHeaders(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const out: Record<string, string> = {};

  // Web `Headers` (used by the OpenAI/Anthropic SDKs) is iterable via forEach.
  // We always lowercase the stored key so downstream `headers["x-request-id"]`
  // lookups work regardless of the provider's original casing.
  try {
    if (typeof (raw as Headers).forEach === "function") {
      (raw as Headers).forEach((value, key) => {
        if (isAllowedHeader(key)) {
          out[key.toLowerCase()] = value;
        }
      });
    } else {
      // Fall back to a plain object of header key/value pairs.
      for (const [key, value] of Object.entries(
        raw as Record<string, unknown>,
      )) {
        if (typeof value === "string" && isAllowedHeader(key)) {
          out[key.toLowerCase()] = value;
        }
      }
    }
  } catch {
    // A malformed Headers-shaped object with a throwing iterator — give up
    // on header capture rather than poisoning the entire extraction.
    return undefined;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Parse a retry delay (in milliseconds) from the response headers, mirroring
 * the logic the OpenAI and Anthropic SDKs use:
 * 1. `retry-after-ms` (non-standard, ms precision) takes precedence.
 * 2. Otherwise `retry-after` (RFC 9110): either delta-seconds or an HTTP-date.
 *
 * Always returns a non-negative value capped at `MAX_RETRY_AFTER_MS`.
 */
function parseRetryAfterMs(
  headers: Record<string, string>,
): number | undefined {
  // `retry-after-ms` (non-standard, OpenAI-specific) is always purely numeric;
  // try whole-value first, then first-of-list, then give up.
  const msRaw = headerValue(headers, "retry-after-ms");
  const ms = numericHeader(msRaw) ?? numericHeader(firstNumericToken(msRaw));
  if (ms !== undefined) {
    return clampRetryAfter(ms);
  }

  const retryAfter = headerValue(headers, "retry-after");
  if (retryAfter !== undefined) {
    // 1. Try the whole value as a delta-seconds number ("30", "-3600").
    const seconds = numericHeader(retryAfter);
    if (seconds !== undefined) {
      return clampRetryAfter(seconds * 1000);
    }
    // 2. Comma-separated numeric list? Take the first token if numeric.
    //    NOTE: HTTP-dates contain commas ("Sat, 01 Jan ..."), so we only
    //    take the first token when it parses as a pure number — otherwise
    //    we'd mangle a perfectly good HTTP-date into "Sat".
    const firstNumeric = numericHeader(firstNumericToken(retryAfter));
    if (firstNumeric !== undefined) {
      return clampRetryAfter(firstNumeric * 1000);
    }
    // 3. Otherwise treat as RFC 9110 HTTP-date.
    const dateMs = Date.parse(retryAfter) - Date.now();
    if (!Number.isNaN(dateMs)) {
      return clampRetryAfter(dateMs);
    }
  }

  return undefined;
}

/**
 * Returns the first comma-separated token of `value` only if it parses as a
 * number. Returns undefined for non-numeric first tokens (notably HTTP-dates
 * like `"Sat, 01 Jan 2026 ..."`) so the caller can fall back to date parsing.
 */
function firstNumericToken(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const first = value.split(",")[0];
  if (first === undefined) {
    return undefined;
  }
  const trimmed = first.trim();
  if (trimmed === "" || Number.isNaN(Number(trimmed))) {
    return undefined;
  }
  return trimmed;
}

/**
 * Strict numeric parse — unlike `parseFloat`, this rejects values with trailing
 * junk (`"5xyz"`, `"30abc"`) instead of silently accepting a prefix.
 */
function numericHeader(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return undefined;
  }
  const parsed = Number(trimmed);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return parsed;
}

function headerValue(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  // Keys are stored lowercased by `normalizeHeaders`, so a direct lookup is
  // sufficient. Keep a case-insensitive fallback for defense in depth in case
  // a caller hands us a non-normalized object.
  const lower = name.toLowerCase();
  if (lower in headers) {
    return headers[lower];
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return value;
    }
  }
  return undefined;
}
