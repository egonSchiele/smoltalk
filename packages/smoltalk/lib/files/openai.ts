import OpenAI from "openai";
import { toFile } from "openai/uploads";
import type { FileProviderContext } from "../files.js";
import type { ProviderFileRef } from "../classes/message/contentParts.js";
import { BaseFileProvider } from "./BaseFileProvider.js";

/** Maps a created OpenAI file (extra response fields intentionally ignored) to a ref. */
export function openaiFileRef(created: { id: string }, mimeType: string): ProviderFileRef {
  return { kind: "providerFile", provider: "openai", id: created.id, mimeType };
}

class OpenAIFileProvider extends BaseFileProvider {
  protected readonly label = "OpenAI";

  protected async doUpload(data: Uint8Array, mimeType: string, ctx: FileProviderContext): Promise<ProviderFileRef> {
    const client = new OpenAI({ apiKey: ctx.apiKey });
    const file = await toFile(data, ctx.filename ?? "upload", { type: mimeType });
    // S5: the mapper below is trivial and won't throw post-create, so no orphan
    // is left here; a provider whose mapper does real work should best-effort delete.
    const created = await client.files.create({ file, purpose: "user_data" });
    return openaiFileRef(created, mimeType);
  }

  protected async doDelete(ref: ProviderFileRef, ctx: { apiKey: string }): Promise<void> {
    const client = new OpenAI({ apiKey: ctx.apiKey });
    await client.files.delete(ref.id);
  }
}

export const openaiFileProvider = new OpenAIFileProvider();
