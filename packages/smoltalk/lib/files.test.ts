import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { uploadFile, deleteFile, registerFileProvider, _resetForTests } from "./files.js";

const okProvider = {
  upload: vi.fn(async (_d: Uint8Array, mimeType: string) => ({ success: true as const, value: { kind: "providerFile" as const, provider: "fake", id: "F1", mimeType } })),
  delete: vi.fn(async () => ({ success: true as const, value: undefined })),
};

describe("files dispatch", () => {
  beforeEach(() => { _resetForTests(); });
  afterEach(() => { vi.clearAllMocks(); delete process.env.OPENAI_API_KEY; });

  const REJECTED = ["ollama", "openrouter", "deepinfra", "litellm", "openai-compat"];
  for (const p of REJECTED) {
    it(`uploadFile rejects ${p} (no Files API) with a message`, async () => {
      const res = await uploadFile({ kind: "base64", base64: "AAA", mimeType: "image/png" }, { provider: p });
      expect(res.success).toBe(false);
      if (!res.success) expect(res.error).toMatch(/no Files API/i);
    });
  }

  it("routes to a registered custom provider (custom providers self-manage auth)", async () => {
    registerFileProvider("fake", okProvider);
    const res = await uploadFile({ kind: "base64", base64: "AAA", mimeType: "text/csv" }, { provider: "fake" });
    expect(res.success).toBe(true);
    expect(okProvider.upload).toHaveBeenCalledWith(expect.any(Uint8Array), "text/csv", expect.anything());
  });

  it("opts.mimeType overrides the loaded mime", async () => {
    registerFileProvider("fake", okProvider);
    await uploadFile({ kind: "base64", base64: "AAA", mimeType: "text/csv" }, { provider: "fake", mimeType: "application/json" });
    expect(okProvider.upload).toHaveBeenCalledWith(expect.any(Uint8Array), "application/json", expect.anything());
  });

  it("fails when no mime can be determined", async () => {
    registerFileProvider("fake", okProvider);
    const res = await uploadFile({ kind: "bytes", data: new Uint8Array([1]), mimeType: "" } as any, { provider: "fake" });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/MIME/i);
  });

  it("rejects an over-cap source (S1)", async () => {
    registerFileProvider("fake", okProvider);
    const big = Buffer.alloc(50).toString("base64");
    const res = await uploadFile({ kind: "base64", base64: big, mimeType: "application/pdf" }, { provider: "fake", maxBytes: 10 });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/exceeds the maximum size/);
  });

  it("built-in requires a resolved key (openai with no key → Failure)", async () => {
    const res = await uploadFile({ kind: "base64", base64: "AAA", mimeType: "image/png" }, { provider: "openai" });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/API key/i);
  });

  it("first-party built-ins are not registry-overridable", async () => {
    const custom = { upload: vi.fn(async () => ({ success: true as const, value: {} as any })), delete: vi.fn() };
    registerFileProvider("openai", custom);
    const res = await uploadFile({ kind: "base64", base64: "AAA", mimeType: "image/png" }, { provider: "openai" });
    expect(res.success).toBe(false);
    expect(custom.upload).not.toHaveBeenCalled();
  });

  it("deleteFile: unsupported provider → Failure; custom provider → success", async () => {
    registerFileProvider("fake", okProvider);
    expect((await deleteFile({ kind: "providerFile", provider: "ollama", id: "x" })).success).toBe(false);
    expect((await deleteFile({ kind: "providerFile", provider: "fake", id: "F1" })).success).toBe(true);
    expect(okProvider.delete).toHaveBeenCalled();
  });
});
