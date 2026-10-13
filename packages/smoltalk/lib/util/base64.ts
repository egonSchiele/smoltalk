/**
 * Bytes to and from base64, and two other byte helpers, written without
 * `Buffer` so they run in a browser. `Uint8Array.fromBase64` and
 * `toBase64` are used where the runtime has them, and `atob`/`btoa` with a
 * loop elsewhere.
 */

type WithToBase64 = Uint8Array & { toBase64?: () => string };
type WithFromBase64 = { fromBase64?: (text: string) => Uint8Array };

export function bytesToBase64(bytes: Uint8Array): string {
  const native = (bytes as WithToBase64).toBase64;
  if (typeof native === "function") {
    return native.call(bytes);
  }
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Decodes standard base64 and base64url (`-` and `_` for `+` and `/`),
 * with or without padding. Any other character throws. `Buffer`, which
 * this replaced, skipped characters it did not know.
 */
export function base64ToBytes(text: string): Uint8Array {
  if (text.includes("-") || text.includes("_")) {
    text = text.replace(/-/g, "+").replace(/_/g, "/");
  }
  const native = (Uint8Array as unknown as WithFromBase64).fromBase64;
  if (typeof native === "function") {
    return native.call(Uint8Array, text);
  }
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/** One array holding every chunk in order. */
export function concatBytes(chunks: Uint8Array[], total?: number): Uint8Array {
  let length = total;
  if (length === undefined) {
    length = 0;
    for (const chunk of chunks) {
      length += chunk.byteLength;
    }
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** The number of bytes `text` takes as UTF-8. */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}
