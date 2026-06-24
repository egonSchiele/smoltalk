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
  }

  return fields;
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
