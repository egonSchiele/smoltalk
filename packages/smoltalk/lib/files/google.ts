import { GoogleGenAI } from "@google/genai";
import type { FileProviderContext } from "../files.js";
import type { ProviderFileRef } from "../classes/message/contentParts.js";
import { BaseFileProvider } from "./BaseFileProvider.js";

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

class GoogleFileProvider extends BaseFileProvider {
  protected readonly label = "Google";

  protected async doUpload(data: Uint8Array, mimeType: string, ctx: FileProviderContext): Promise<ProviderFileRef> {
    const ai = new GoogleGenAI({ apiKey: ctx.apiKey });
    // P2 (follow-up): `new Blob([data])` copies the buffer; prefer a no-copy /
    // streaming form if the SDK supports it. Blob is acceptable for v1.
    const blob = new Blob([data as BlobPart], { type: mimeType });
    const uploaded = await ai.files.upload({ file: blob, config: { mimeType } });
    return googleFileRef(uploaded as any, mimeType);
  }

  protected async doDelete(ref: ProviderFileRef, ctx: { apiKey: string }): Promise<void> {
    const ai = new GoogleGenAI({ apiKey: ctx.apiKey });
    await ai.files.delete({ name: ref.id });
  }
}

export const googleFileProvider = new GoogleFileProvider();
