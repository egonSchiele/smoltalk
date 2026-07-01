import Anthropic, { toFile } from "@anthropic-ai/sdk";
import type { FileProviderContext } from "../files.js";
import type { ProviderFileRef } from "../classes/message/contentParts.js";
import { BaseFileProvider } from "./BaseFileProvider.js";

const FILES_BETA = "files-api-2025-04-14";

export function anthropicFileRef(uploaded: { id: string; mime_type?: string }, mimeType: string): ProviderFileRef {
  return { kind: "providerFile", provider: "anthropic", id: uploaded.id, mimeType: uploaded.mime_type ?? mimeType };
}

class AnthropicFileProvider extends BaseFileProvider {
  protected readonly label = "Anthropic";

  protected async doUpload(data: Uint8Array, mimeType: string, ctx: FileProviderContext): Promise<ProviderFileRef> {
    const client = new Anthropic({ apiKey: ctx.apiKey });
    const file = await toFile(data, ctx.filename ?? "upload", { type: mimeType });
    const uploaded = await client.beta.files.upload({ file, betas: [FILES_BETA] });
    return anthropicFileRef(uploaded, mimeType);
  }

  protected async doDelete(ref: ProviderFileRef, ctx: { apiKey: string }): Promise<void> {
    const client = new Anthropic({ apiKey: ctx.apiKey });
    await client.beta.files.delete(ref.id, { betas: [FILES_BETA] });
  }
}

export const anthropicFileProvider = new AnthropicFileProvider();
