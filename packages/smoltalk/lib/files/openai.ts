import OpenAI from "openai";
import { toFile } from "openai/uploads";
import type { FileProvider, FileProviderContext } from "../files.js";
import type { ProviderFileRef } from "../classes/message/contentParts.js";
import { Result, success, failure } from "../types/result.js";
import { getLogger } from "../util/logger.js";
import { redactSecret } from "../util/redact.js";

/** Maps a created OpenAI file (extra response fields intentionally ignored) to a ref. */
export function openaiFileRef(created: { id: string }, mimeType: string): ProviderFileRef {
  return { kind: "providerFile", provider: "openai", id: created.id, mimeType };
}

export const openaiFileProvider: FileProvider = {
  async upload(data: Uint8Array, mimeType: string, ctx: FileProviderContext): Promise<Result<ProviderFileRef>> {
    try {
      const client = new OpenAI({ apiKey: ctx.apiKey });
      const file = await toFile(data, ctx.filename ?? "upload", { type: mimeType });
      // S5: the mapper below is trivial and won't throw post-create, so no orphan
      // is left here; a provider whose mapper does real work should best-effort delete.
      const created = await client.files.create({ file, purpose: "user_data" });
      return success(openaiFileRef(created, mimeType));
    } catch (err) {
      getLogger().error("OpenAI file upload failed:", err);
      return failure(`OpenAI file upload failed: ${redactSecret((err as Error).message, ctx.apiKey)}`);
    }
  },
  async delete(ref, ctx): Promise<Result<void>> {
    try {
      const client = new OpenAI({ apiKey: ctx.apiKey });
      await client.files.delete(ref.id);
      return success(undefined);
    } catch (err) {
      getLogger().error("OpenAI file delete failed:", err);
      return failure(`OpenAI file delete failed: ${redactSecret((err as Error).message, ctx.apiKey)}`);
    }
  },
};
