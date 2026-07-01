// Requires: OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY (each case skips if unset).
import { describe, it, expect } from "vitest";
import { uploadFile, deleteFile } from "./files.js";
import { textSync } from "./functions.js";
import { userMessage, filePart, imagePart } from "./classes/message/index.js";

// A small valid PDF and a 1x1 PNG, inlined so no binary fixtures are needed.
const PDF = new Uint8Array(Buffer.from("JVBERi0xLjQKJfCflqQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCAyMDAgMjAwXT4+CmVuZG9iagp0cmFpbGVyPDwvUm9vdCAxIDAgUj4+", "base64"));
const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));

const cases = [
  { provider: "openai", model: "gpt-4o", callProvider: "openai-responses", key: process.env.OPENAI_API_KEY },
  { provider: "anthropic", model: "claude-sonnet-4-5", callProvider: "anthropic", key: process.env.ANTHROPIC_API_KEY },
  { provider: "google", model: "gemini-2.5-flash", callProvider: "google", key: process.env.GEMINI_API_KEY },
];

describe("files API live round-trip", () => {
  for (const c of cases) {
    const run = c.key ? it : it.skip;

    run(`${c.provider}: pdf upload → reference → delete`, async () => {
      const up = await uploadFile({ kind: "bytes", data: PDF, mimeType: "application/pdf" }, { provider: c.provider });
      expect(up.success).toBe(true);
      if (!up.success) return;
      const res = await textSync({ model: c.model as any, provider: c.callProvider, messages: [userMessage(["Reply OK.", filePart(up.value)])] });
      expect(res.success).toBe(true);
      expect((await deleteFile(up.value)).success).toBe(true);
    });

    // Image-by-file_id: only openai-responses + anthropic support it.
    if (c.provider !== "google") {
      run(`${c.provider}: image upload → reference (image-by-file_id)`, async () => {
        const up = await uploadFile({ kind: "bytes", data: PNG, mimeType: "image/png" }, { provider: c.provider });
        expect(up.success).toBe(true);
        if (!up.success) return;
        const res = await textSync({ model: c.model as any, provider: c.callProvider, messages: [userMessage(["Reply OK.", imagePart(up.value)])] });
        expect(res.success).toBe(true);
        await deleteFile(up.value);
      });
    }
  }

  const oai = process.env.OPENAI_API_KEY ? it : it.skip;
  oai("openai Chat image-by-file_id is rejected", async () => {
    const up = await uploadFile({ kind: "bytes", data: PNG, mimeType: "image/png" }, { provider: "openai" });
    expect(up.success).toBe(true);
    if (!up.success) return;
    const res = await textSync({ model: "gpt-4o" as any, provider: "openai", messages: [userMessage([imagePart(up.value)])] });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/openai-responses/);
    await deleteFile(up.value);
  });
});
