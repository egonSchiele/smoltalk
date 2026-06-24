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
   */
  retryAfterMs?: number;
  /** Provider request id (`x-request-id` / `request-id`), useful for support tickets. */
  requestId?: string;
}

// Allowlist, not denylist. smoltalk can be pointed at proxies (LiteLLM,
// OpenRouter) that re-emit upstream headers verbatim, and some APIs echo
// credentials back on errors — a denylist would pass `authorization`,
// `x-api-key`, forwarded `llm_provider-*` headers, etc. (cf. Traefik
// GHSA-p6hg-qh38-555r). Capture only headers with diagnostic value; the raw
// provider error remains on `SmolError.cause` as the escape hatch.
const ALLOWED_HEADERS = new Set([
  "retry-after",
  "retry-after-ms",
  "request-id",
  "x-request-id",
  "content-type",
]);
const ALLOWED_HEADER_PREFIXES = ["x-ratelimit-", "anthropic-ratelimit-"];

function isAllowedHeader(name: string): boolean {
  const lower = name.toLowerCase();
  if (ALLOWED_HEADERS.has(lower)) {
    return true;
  }
  for (const prefix of ALLOWED_HEADER_PREFIXES) {
    if (lower.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

export function extractHttpErrorFields(error: unknown): HttpErrorFields {
  const fields: HttpErrorFields = {};
  if (!error || typeof error !== "object") {
    return fields;
  }

  const err = error as Record<string, unknown>;

  const status = err.status ?? err.statusCode ?? err.status_code;
  if (typeof status === "number") {
    fields.status = status;
  }

  const headers = normalizeHeaders(err.headers);
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
  if (typeof err.requestID === "string") {
    return err.requestID;
  }
  if (typeof err.request_id === "string") {
    return err.request_id;
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
  if (typeof (raw as Headers).forEach === "function") {
    (raw as Headers).forEach((value, key) => {
      if (isAllowedHeader(key)) {
        out[key] = value;
      }
    });
  } else {
    // Fall back to a plain object of header key/value pairs.
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === "string" && isAllowedHeader(key)) {
        out[key] = value;
      }
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Parse a retry delay (in milliseconds) from the response headers, mirroring
 * the logic the OpenAI and Anthropic SDKs use:
 * 1. `retry-after-ms` (non-standard, ms precision) takes precedence.
 * 2. Otherwise `retry-after` (RFC 9110): either delta-seconds or an HTTP-date.
 */
function parseRetryAfterMs(
  headers: Record<string, string>,
): number | undefined {
  const ms = numericHeader(headerValue(headers, "retry-after-ms"));
  if (ms !== undefined) {
    return Math.round(ms);
  }

  const retryAfter = headerValue(headers, "retry-after");
  if (retryAfter !== undefined) {
    const seconds = numericHeader(retryAfter);
    if (seconds !== undefined) {
      return Math.round(seconds * 1000);
    }
    const dateMs = Date.parse(retryAfter) - Date.now();
    if (!Number.isNaN(dateMs)) {
      return Math.max(0, dateMs);
    }
  }

  return undefined;
}

/**
 * Strict numeric parse — unlike `parseFloat`, this rejects values with trailing
 * junk (`"5xyz"`, `"30, 60"`) instead of silently accepting a prefix.
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
  if (name in headers) {
    return headers[name];
  }
  // Plain-object headers may not be lowercased; fall back to a case-insensitive scan.
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return value;
    }
  }
  return undefined;
}
