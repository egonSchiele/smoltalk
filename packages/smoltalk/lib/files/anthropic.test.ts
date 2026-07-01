import { describe, it, expect, vi, afterEach } from "vitest";

const h = vi.hoisted(() => ({ upload: vi.fn(), del: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(function () { return { beta: { files: { upload: h.upload, delete: h.del } } }; }),
  toFile: async (data: any, name: any, o: any) => ({ __file: true, name, type: o?.type, data }),
}));

import { anthropicFileProvider, anthropicFileRef } from "./anthropic.js";

describe("anthropicFileRef", () => {
  it("prefers the provider-echoed mime, falls back to caller mime", () => {
    expect(anthropicFileRef({ id: "file_1", mime_type: "image/webp" }, "image/png").mimeType).toBe("image/webp");
    expect(anthropicFileRef({ id: "file_1" }, "image/png").mimeType).toBe("image/png");
  });
});

describe("anthropicFileProvider.upload/delete", () => {
  afterEach(() => vi.clearAllMocks());
  it("uploads with the files beta and returns the ref", async () => {
    h.upload.mockResolvedValueOnce({ id: "file_1" });
    const res = await anthropicFileProvider.upload(new Uint8Array([1]), "application/pdf", { apiKey: "k" });
    expect(res.success).toBe(true);
    expect(h.upload).toHaveBeenCalledWith(expect.objectContaining({ betas: ["files-api-2025-04-14"] }));
  });
  it("returns Failure when the SDK throws", async () => {
    h.upload.mockRejectedValueOnce(new Error("nope"));
    const res = await anthropicFileProvider.upload(new Uint8Array([1]), "application/pdf", { apiKey: "k" });
    expect(res.success).toBe(false);
  });
  it("delete passes the id and the beta", async () => {
    h.del.mockResolvedValueOnce({});
    await anthropicFileProvider.delete({ kind: "providerFile", provider: "anthropic", id: "file_1" }, { apiKey: "k" });
    expect(h.del).toHaveBeenCalledWith("file_1", expect.objectContaining({ betas: ["files-api-2025-04-14"] }));
  });
});
