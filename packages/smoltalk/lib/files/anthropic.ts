import Anthropic, { toFile } from "@anthropic-ai/sdk";
import type { FileProvider, FileProviderContext } from "../files.js";
import type { ProviderFileRef } from "../classes/message/contentParts.js";
import { Result, success, failure } from "../types/result.js";
import { getLogger } from "../util/logger.js";
import { redactSecret } from "../util/redact.js";

const FILES_BETA = "files-api-2025-04-14";

export function anthropicFileRef(uploaded: { id: string; mime_type?: string }, mimeType: string): ProviderFileRef {
  return { kind: "providerFile", provider: "anthropic", id: uploaded.id, mimeType: uploaded.mime_type ?? mimeType };
}

export const anthropicFileProvider: FileProvider = {
  async upload(data: Uint8Array, mimeType: string, ctx: FileProviderContext): Promise<Result<ProviderFileRef>> {
    try {
      const client = new Anthropic({ apiKey: ctx.apiKey });
      const file = await toFile(data, ctx.filename ?? "upload", { type: mimeType });
      const uploaded = await client.beta.files.upload({ file, betas: [FILES_BETA] });
      return success(anthropicFileRef(uploaded, mimeType));
    } catch (err) {
      getLogger().error("Anthropic file upload failed:", err);
      return failure(`Anthropic file upload failed: ${redactSecret((err as Error).message, ctx.apiKey)}`);
    }
  },
  async delete(ref, ctx): Promise<Result<void>> {
    try {
      const client = new Anthropic({ apiKey: ctx.apiKey });
      await client.beta.files.delete(ref.id, { betas: [FILES_BETA] });
      return success(undefined);
    } catch (err) {
      getLogger().error("Anthropic file delete failed:", err);
      return failure(`Anthropic file delete failed: ${redactSecret((err as Error).message, ctx.apiKey)}`);
    }
  },
};
