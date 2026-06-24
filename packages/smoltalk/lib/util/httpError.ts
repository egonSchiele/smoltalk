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
  headers?: Record<string, string>;
  /**
   * Suggested wait before retrying, in milliseconds, parsed from the
   * `retry-after-ms` / `retry-after` response headers (when present).
   */
  retryAfterMs?: number;
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

  return fields;
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
  const ms = headerValue(headers, "retry-after-ms");
  if (ms !== undefined) {
    const parsed = parseFloat(ms);
    if (!Number.isNaN(parsed)) {
      return Math.round(parsed);
    }
  }

  const retryAfter = headerValue(headers, "retry-after");
  if (retryAfter !== undefined) {
    const seconds = parseFloat(retryAfter);
    if (!Number.isNaN(seconds)) {
      return Math.round(seconds * 1000);
    }
    const dateMs = Date.parse(retryAfter) - Date.now();
    if (!Number.isNaN(dateMs)) {
      return Math.max(0, dateMs);
    }
  }

  return undefined;
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

function normalizeHeaders(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const out: Record<string, string> = {};

  // Web `Headers` (used by the OpenAI/Anthropic SDKs) is iterable via forEach.
  if (typeof (raw as Headers).forEach === "function") {
    (raw as Headers).forEach((value, key) => {
      out[key] = value;
    });
  } else {
    // Fall back to a plain object of header key/value pairs.
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === "string") {
        out[key] = value;
      }
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}
