import { describe, it, expect, vi, afterEach } from "vitest";

const h = vi.hoisted(() => ({ create: vi.fn(), del: vi.fn() }));
vi.mock("openai", () => ({ default: vi.fn(function () { return { files: { create: h.create, delete: h.del } }; }) }));
vi.mock("openai/uploads", () => ({ toFile: async (data: any, name: any, o: any) => ({ __file: true, name, type: o?.type, data }) }));

import { openaiFileProvider, openaiFileRef } from "./openai.js";

describe("openaiFileRef", () => {
  it("shapes a ProviderFileRef and ignores extra SDK fields on purpose", () => {
    expect(openaiFileRef({ id: "file-abc" }, "application/pdf")).toEqual({
      kind: "providerFile", provider: "openai", id: "file-abc", mimeType: "application/pdf",
    });
  });
});

describe("openaiFileProvider.upload/delete", () => {
  afterEach(() => vi.clearAllMocks());
  it("uploads with purpose=user_data and returns the ref", async () => {
    h.create.mockResolvedValueOnce({ id: "file-1" });
    const res = await openaiFileProvider.upload(new Uint8Array([1]), "application/pdf", { apiKey: "k", filename: "r.pdf" });
    expect(res.success).toBe(true);
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ purpose: "user_data" }));
    if (res.success) expect(res.value.id).toBe("file-1");
  });
  it("returns Failure when the SDK throws", async () => {
    h.create.mockRejectedValueOnce(new Error("boom"));
    const res = await openaiFileProvider.upload(new Uint8Array([1]), "application/pdf", { apiKey: "k" });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/boom/);
  });
  it("delete calls files.delete(id)", async () => {
    h.del.mockResolvedValueOnce({});
    const res = await openaiFileProvider.delete({ kind: "providerFile", provider: "openai", id: "file-1" }, { apiKey: "k" });
    expect(res.success).toBe(true);
    expect(h.del).toHaveBeenCalledWith("file-1");
  });
});
