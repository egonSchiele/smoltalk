import { Result, success, failure } from "./types/result.js";
import type { SmolConfig } from "./types.js";
import { ProviderFileRef } from "./classes/message/contentParts.js";
import { BlobRef, loadBlob } from "./util/imageRef.js";
import { fileFamily } from "./util/attachments.js";
import { resolveApiKey, resolveBaseUrl } from "./util/provider.js";
import { openaiFileProvider } from "./files/openai.js";
import { anthropicFileProvider } from "./files/anthropic.js";
import { googleFileProvider } from "./files/google.js";

/** Default cap on a resolved upload's size. Callers can raise it via opts.maxBytes. */
export const DEFAULT_UPLOAD_BYTES = 100 * 1024 * 1024;

/**
 * Options for {@link uploadFile}.
 *
 * ⚠️ Security: `{ kind: "path" }` sources read any file the process can access —
 * do NOT pass untrusted user input as a path. `{ kind: "url" }` sources fetch
 * arbitrary http(s) URLs; in a server that accepts user URLs, treat this as an
 * SSRF surface (a full private-IP guard is a planned follow-up).
 *
 * Lifecycle: uploaded files persist on the provider until you call `deleteFile`
 * (OpenAI keeps them indefinitely — storage bills accrue; Anthropic applies a
 * retention window, so a cached ref can 404 later; Google auto-expires ~48h,
 * surfaced as `expiresAt`). `uploadFile` is the recommended path for files more
 * than a few MB — it sends bytes directly, avoiding the base64 round-trip that
 * inline attachments pay.
 */
export type UploadFileOptions = {
  provider: string;
  mimeType?: string;
  filename?: string;
  /** Max resolved size in bytes. Default {@link DEFAULT_UPLOAD_BYTES} (100 MB). */
  maxBytes?: number;
  apiKey?: SmolConfig["apiKey"];
  baseUrl?: SmolConfig["baseUrl"];
};

export type FileProviderContext = {
  apiKey: string;
  baseUrl?: string;
  filename?: string;
};

export type FileProvider = {
  upload(data: Uint8Array, mimeType: string, ctx: FileProviderContext): Promise<Result<ProviderFileRef>>;
  delete(ref: ProviderFileRef, ctx: { apiKey: string; baseUrl?: string }): Promise<Result<void>>;
};

const BUILT_INS: Record<"openai" | "anthropic" | "google", FileProvider> = {
  openai: openaiFileProvider,
  anthropic: anthropicFileProvider,
  google: googleFileProvider,
};

const registered: Record<string, FileProvider> = Object.create(null);
export function registerFileProvider(name: string, impl: FileProvider): void {
  registered[name] = impl;
}

// First-party built-ins win (not registry-overridable); unknown → registry.
function selectProvider(provider: string): { impl: FileProvider; builtin: boolean } | null {
  const family = fileFamily(provider);
  if (family !== null) {
    return { impl: BUILT_INS[family], builtin: true };
  }
  const custom = registered[provider];
  if (custom) {
    return { impl: custom, builtin: false };
  }
  return null;
}

export async function uploadFile(
  source: BlobRef,
  opts: UploadFileOptions,
): Promise<Result<ProviderFileRef>> {
  const sel = selectProvider(opts.provider);
  if (!sel) {
    return failure(`Provider "${opts.provider}" has no Files API. Supported: openai, anthropic, google.`);
  }

  const maxBytes = opts.maxBytes ?? DEFAULT_UPLOAD_BYTES;
  let loaded: { data: Uint8Array; mimeType?: string };
  try {
    loaded = await loadBlob(source, { maxBytes });
  } catch (err) {
    return failure(`Failed to load file for upload: ${(err as Error).message}`);
  }
  const mimeType = opts.mimeType ?? loaded.mimeType;
  if (!mimeType || mimeType.trim() === "") {
    return failure("Could not determine the file's MIME type; pass opts.mimeType.");
  }

  const apiKey = resolveApiKey(opts.provider, { apiKey: opts.apiKey });
  if (sel.builtin && !apiKey) {
    return failure(`No API key for provider "${opts.provider}". Set config.apiKey or the provider's env var.`);
  }
  const baseUrl = resolveBaseUrl(opts.provider, { baseUrl: opts.baseUrl });
  return sel.impl.upload(loaded.data, mimeType, { apiKey: apiKey ?? "", baseUrl, filename: opts.filename });
}

export async function deleteFile(
  ref: ProviderFileRef,
  opts: { apiKey?: SmolConfig["apiKey"]; baseUrl?: SmolConfig["baseUrl"] } = {},
): Promise<Result<void>> {
  const sel = selectProvider(ref.provider);
  if (!sel) {
    return failure(`Provider "${ref.provider}" has no Files API.`);
  }
  const apiKey = resolveApiKey(ref.provider, { apiKey: opts.apiKey });
  if (sel.builtin && !apiKey) {
    return failure(`No API key for provider "${ref.provider}".`);
  }
  const baseUrl = resolveBaseUrl(ref.provider, { baseUrl: opts.baseUrl });
  return sel.impl.delete(ref, { apiKey: apiKey ?? "", baseUrl });
}
