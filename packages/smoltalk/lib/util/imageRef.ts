import { readFile, stat } from "node:fs/promises";
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

/** Neutral alias of the source union for non-image uses (uploads via {@link loadBlob}). */
export type BlobRef = ImageRef;

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
  const result = await loadRef(ref, allowed, options.maxBytes);
  if (options.maxBytes !== undefined && result.data.length > options.maxBytes) {
    throw new Error(
      `Attachment exceeds the maximum size of ${options.maxBytes} bytes ` +
        `(got ${result.data.length} bytes).`,
    );
  }
  if (!result.mimeType) {
    throw new Error("internal: gated load returned no mimeType");
  }
  return { data: result.data, mimeType: result.mimeType };
}

/**
 * Load a source to bytes WITHOUT the image MIME gate (used by file uploads,
 * which accept any type). Enforces `maxBytes` across all kinds.
 */
export async function loadBlob(
  ref: ImageRef,
  options: { maxBytes?: number } = {},
): Promise<{ data: Uint8Array; mimeType?: string }> {
  const result = await loadRef(ref, null, options.maxBytes);
  if (options.maxBytes !== undefined && result.data.length > options.maxBytes) {
    throw tooLargeError(options.maxBytes, result.data.length);
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
  return new Uint8Array(Buffer.concat(chunks));
}

async function loadRef(
  ref: ImageRef,
  allowed: string[] | null,
  maxBytes?: number,
): Promise<{ data: Uint8Array; mimeType?: string }> {
  switch (ref.kind) {
    case "bytes":
      return { data: ref.data, mimeType: ref.mimeType };
    case "base64":
      return {
        data: new Uint8Array(Buffer.from(ref.base64, "base64")),
        mimeType: ref.mimeType,
      };
    case "path": {
      // S1: bound memory — reject on stat before reading the whole file.
      if (maxBytes !== undefined) {
        const info = await stat(ref.path);
        if (info.size > maxBytes) {
          throw tooLargeError(maxBytes, info.size);
        }
      }
      const buf = await readFile(ref.path);
      const ext = extname(ref.path).toLowerCase();
      const inferred = EXT_TO_MIME[ext];
      const mimeType = ref.mimeType ?? inferred;
      if (allowed !== null && (!mimeType || !isAllowedMime(mimeType, allowed))) {
        throw new Error(
          `Could not determine an allowed MIME type for path "${ref.path}". ` +
            `Allowed: ${allowed.join(", ")}. Pass an explicit mimeType on the ImageRef.`,
        );
      }
      return { data: new Uint8Array(buf), mimeType };
    }
    case "url": {
      // S2: only http(s) — reject file:/ftp:/gopher:/data: etc.
      let scheme: string;
      try {
        scheme = new URL(ref.url).protocol;
      } catch {
        throw new Error(`Invalid attachment URL: "${ref.url}".`);
      }
      if (scheme !== "http:" && scheme !== "https:") {
        throw new Error(
          `Unsupported URL scheme "${scheme}" for attachment; only http(s) is allowed.`,
        );
      }
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
      if (allowed !== null && (!mimeType || !isAllowedMime(mimeType, allowed))) {
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
