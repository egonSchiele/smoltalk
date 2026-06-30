const MAX_STRING = 2048;

/**
 * Deep copy of `value` with attachment payloads (base64 / data URIs) replaced by
 * a short summary, so logs and observability never carry large media blobs.
 * Normal prose is left intact (only base64-shaped strings are summarized).
 */
export function redactAttachments(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactAttachments(v));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactAttachments(v);
    }
    return out;
  }
  return value;
}

function redactString(s: string): string {
  const marker = ";base64,";
  if (s.startsWith("data:") && s.includes(marker)) {
    const prefix = s.slice(0, s.indexOf(marker) + marker.length);
    return `${prefix}[redacted ${s.length} chars]`;
  }
  // A bare base64 payload is a single unbroken token. Requiring zero whitespace
  // keeps prose (which has spaces) intact even when it's long and punctuation-free.
  if (s.length > MAX_STRING && /^[A-Za-z0-9+/=]+$/.test(s)) {
    return `[redacted ${s.length} base64 chars]`;
  }
  return s;
}
