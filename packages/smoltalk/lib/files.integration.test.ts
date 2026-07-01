import { describe, it, expect } from "vitest";
import { registerFileProvider, uploadFile } from "./files.js";
import { resolveMessageAttachments } from "./clients/resolveAttachments.js";
import { userMessage, filePart } from "./classes/message/index.js";

describe("files pipeline (mocked provider, no keys)", () => {
  it("uploadFile → filePart → resolver guard runs end-to-end", async () => {
    registerFileProvider("fake", {
      async upload(_d, mimeType) {
        return { success: true as const, value: { kind: "providerFile" as const, provider: "fake", id: "F9", mimeType } };
      },
      async delete() { return { success: true as const, value: undefined }; },
    });
    const up = await uploadFile({ kind: "base64", base64: "AAA", mimeType: "application/pdf" }, { provider: "fake" });
    expect(up.success).toBe(true);
    if (!up.success) return;

    // fileFamily("fake") is null → the resolver rejects it (proves the guard runs end-to-end).
    const res = await resolveMessageAttachments([userMessage([filePart(up.value)])], { provider: "fake", maxBytes: 1 });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/file family/i);
  });
});
