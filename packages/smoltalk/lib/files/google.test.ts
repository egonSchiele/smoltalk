import { describe, it, expect, vi, afterEach } from "vitest";

const h = vi.hoisted(() => ({ upload: vi.fn(), del: vi.fn() }));
vi.mock("@google/genai", () => ({ GoogleGenAI: vi.fn(function () { return { files: { upload: h.upload, delete: h.del } }; }) }));

import { googleFileProvider, googleFileRef } from "./google.js";

describe("googleFileRef", () => {
  it("maps name→id, uri→uri, expirationTime→epoch ms", () => {
    const ref = googleFileRef({ name: "files/abc", uri: "https://x/files/abc", expirationTime: "2026-07-01T00:00:00Z" }, "application/pdf");
    expect(ref).toEqual({
      kind: "providerFile", provider: "google", id: "files/abc", uri: "https://x/files/abc",
      mimeType: "application/pdf", expiresAt: Date.parse("2026-07-01T00:00:00Z"),
    });
  });
  it("omits expiresAt when expirationTime is absent or unparseable", () => {
    expect(googleFileRef({ name: "files/x", uri: "u" }, "image/png").expiresAt).toBeUndefined();
    expect(googleFileRef({ name: "files/x", uri: "u", expirationTime: "not-a-date" }, "image/png").expiresAt).toBeUndefined();
  });
  it("throws when name is missing", () => {
    expect(() => googleFileRef({ uri: "u" }, "image/png")).toThrow(/name/);
  });
});

describe("googleFileProvider.upload/delete", () => {
  afterEach(() => vi.clearAllMocks());
  it("uploads with config.mimeType and returns the ref", async () => {
    h.upload.mockResolvedValueOnce({ name: "files/abc", uri: "u", expirationTime: "2026-07-01T00:00:00Z" });
    const res = await googleFileProvider.upload(new Uint8Array([1]), "application/pdf", { apiKey: "k" });
    expect(res.success).toBe(true);
    expect(h.upload).toHaveBeenCalledWith(expect.objectContaining({ config: { mimeType: "application/pdf" } }));
  });
  it("returns Failure when the SDK throws", async () => {
    h.upload.mockRejectedValueOnce(new Error("bad"));
    const res = await googleFileProvider.upload(new Uint8Array([1]), "application/pdf", { apiKey: "k" });
    expect(res.success).toBe(false);
  });
  it("delete calls files.delete({ name })", async () => {
    h.del.mockResolvedValueOnce({});
    await googleFileProvider.delete({ kind: "providerFile", provider: "google", id: "files/abc" }, { apiKey: "k" });
    expect(h.del).toHaveBeenCalledWith({ name: "files/abc" });
  });
});
