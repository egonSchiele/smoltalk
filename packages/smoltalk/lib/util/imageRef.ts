import { readFile } from "node:fs/promises";
import { extname } from "node:path";

export type ImageRef =
  | { kind: "bytes"; data: Uint8Array; mimeType: string }
  | { kind: "base64"; base64: string; mimeType: string }
  | { kind: "path"; path: string; mimeType?: string }
  | {
      kind: "url";
      url: string;
      mimeType?: string;
      /**
       * Maximum time in milliseconds to wait for the URL to respond before
       * aborting. Defaults to {@link DEFAULT_FETCH_TIMEOUT_MS} (60 seconds).
       */
      timeoutMs?: number;
    };

export type NormalizedImage = {
  data: Uint8Array;
  mimeType: string;
};

/** Default timeout for fetching image URLs during normalization (60 seconds). */
export const DEFAULT_FETCH_TIMEOUT_MS = 60_000;

const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
};

function isAllowedMime(mimeType: string, allowedPrefixes: string[]): boolean {
  for (const prefix of allowedPrefixes) {
    if (mimeType.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

export async function normalizeImageRef(
  ref: ImageRef,
  options: { allowedMimePrefixes?: string[]; maxBytes?: number } = {},
): Promise<NormalizedImage> {
  const allowed = options.allowedMimePrefixes ?? ["image/"];
  const result = await loadImageRef(ref, allowed, options.maxBytes);
  if (options.maxBytes !== undefined && result.data.length > options.maxBytes) {
    throw new Error(
      `Attachment exceeds the maximum size of ${options.maxBytes} bytes ` +
        `(got ${result.data.length} bytes).`,
    );
  }
  return result;
}

function tooLargeError(maxBytes: number, got: number | string): Error {
  return new Error(
    `Attachment exceeds the maximum size of ${maxBytes} bytes (got ${got} bytes).`,
  );
}

/**
 * Read a response body into memory, aborting as soon as the running total
 * exceeds `maxBytes` so a large or hostile URL can't exhaust memory. Falls back
 * to buffering whole when the body isn't streamable.
 */
async function readBodyWithLimit(
  res: Response,
  maxBytes?: number,
): Promise<Uint8Array> {
  if (maxBytes === undefined || !res.body) {
    return new Uint8Array(await res.arrayBuffer());
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooLargeError(maxBytes, `>${total}`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function loadImageRef(
  ref: ImageRef,
  allowed: string[],
  maxBytes?: number,
): Promise<NormalizedImage> {
  switch (ref.kind) {
    case "bytes":
      return { data: ref.data, mimeType: ref.mimeType };
    case "base64":
      return {
        data: new Uint8Array(Buffer.from(ref.base64, "base64")),
        mimeType: ref.mimeType,
      };
    case "path": {
      const buf = await readFile(ref.path);
      const ext = extname(ref.path).toLowerCase();
      const inferred = EXT_TO_MIME[ext];
      const mimeType = ref.mimeType ?? inferred;
      if (!mimeType || !isAllowedMime(mimeType, allowed)) {
        throw new Error(
          `Could not determine an allowed MIME type for path "${ref.path}". ` +
            `Allowed: ${allowed.join(", ")}. Pass an explicit mimeType on the ImageRef.`,
        );
      }
      return { data: new Uint8Array(buf), mimeType };
    }
    case "url": {
      const timeoutMs = ref.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
      const res = await fetch(ref.url, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        throw new Error(
          `Failed to fetch attachment from ${ref.url}: ${res.status}`,
        );
      }
      // Reject on an honest Content-Length before reading a single byte of body.
      const declaredLength = Number(res.headers.get("content-length"));
      if (maxBytes !== undefined && declaredLength > maxBytes) {
        throw tooLargeError(maxBytes, declaredLength);
      }
      const buf = await readBodyWithLimit(res, maxBytes);
      const contentType = res.headers.get("content-type") ?? undefined;
      const mimeType = ref.mimeType ?? contentType;
      if (!mimeType || !isAllowedMime(mimeType, allowed)) {
        throw new Error(
          `Could not determine an allowed MIME type for URL "${ref.url}". ` +
            `Response Content-Type was "${contentType ?? "missing"}". ` +
            `Allowed: ${allowed.join(", ")}. Pass an explicit mimeType on the ImageRef.`,
        );
      }
      return { data: buf, mimeType };
    }
  }
}
