import { readFile } from "node:fs/promises";
import { extname } from "node:path";

export type ImageRef =
  | { kind: "bytes"; data: Uint8Array; mimeType: string }
  | { kind: "base64"; base64: string; mimeType: string }
  | { kind: "path"; path: string; mimeType?: string }
  | { kind: "url"; url: string; mimeType?: string };

export type NormalizedImage = {
  data: Uint8Array;
  mimeType: string;
};

const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function normalizeImageRef(
  ref: ImageRef,
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
      if (!mimeType || !mimeType.startsWith("image/")) {
        throw new Error(
          `Could not determine image MIME type for path "${ref.path}". ` +
            `Pass an explicit mimeType (e.g. "image/png") on the ImageRef.`,
        );
      }
      return { data: new Uint8Array(buf), mimeType };
    }
    case "url": {
      const res = await fetch(ref.url);
      if (!res.ok) {
        throw new Error(
          `Failed to fetch image from ${ref.url}: ${res.status}`,
        );
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      const contentType = res.headers.get("content-type") ?? undefined;
      const mimeType = ref.mimeType ?? contentType;
      if (!mimeType || !mimeType.startsWith("image/")) {
        throw new Error(
          `Could not determine image MIME type for URL "${ref.url}". ` +
            `Response Content-Type was "${contentType ?? "missing"}". ` +
            `Pass an explicit mimeType (e.g. "image/png") on the ImageRef.`,
        );
      }
      return { data: buf, mimeType };
    }
  }
}
