import { GoogleGenAI } from "@google/genai";
import type { FileProvider, FileProviderContext } from "../files.js";
import type { ProviderFileRef } from "../classes/message/contentParts.js";
import { Result, success, failure } from "../types/result.js";
import { getLogger } from "../util/logger.js";
import { redactSecret } from "../util/redact.js";

export function googleFileRef(
  uploaded: { name?: string; uri?: string; mimeType?: string; expirationTime?: string },
  mimeType: string,
): ProviderFileRef {
  if (!uploaded.name) {
    throw new Error("Google files.upload returned no name; cannot build a ProviderFileRef.");
  }
  let expiresAt: number | undefined;
  if (uploaded.expirationTime) {
    const parsed = Date.parse(uploaded.expirationTime);
    if (Number.isFinite(parsed)) {
      expiresAt = parsed;
    }
  }
  return {
    kind: "providerFile",
    provider: "google",
    id: uploaded.name,
    uri: uploaded.uri,
    mimeType: uploaded.mimeType ?? mimeType,
    expiresAt,
  };
}

export const googleFileProvider: FileProvider = {
  async upload(data: Uint8Array, mimeType: string, ctx: FileProviderContext): Promise<Result<ProviderFileRef>> {
    try {
      const ai = new GoogleGenAI({ apiKey: ctx.apiKey });
      // P2 (follow-up): `new Blob([data])` copies the buffer; prefer a no-copy /
      // streaming form if the SDK supports it. Blob is acceptable for v1.
      const blob = new Blob([data as BlobPart], { type: mimeType });
      const uploaded = await ai.files.upload({ file: blob, config: { mimeType } });
      return success(googleFileRef(uploaded as any, mimeType));
    } catch (err) {
      getLogger().error("Google file upload failed:", err);
      return failure(`Google file upload failed: ${redactSecret((err as Error).message, ctx.apiKey)}`);
    }
  },
  async delete(ref, ctx): Promise<Result<void>> {
    try {
      const ai = new GoogleGenAI({ apiKey: ctx.apiKey });
      await ai.files.delete({ name: ref.id });
      return success(undefined);
    } catch (err) {
      getLogger().error("Google file delete failed:", err);
      return failure(`Google file delete failed: ${redactSecret((err as Error).message, ctx.apiKey)}`);
    }
  },
};
