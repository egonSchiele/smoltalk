import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveMessageAttachments, acceptsRemoteUrl } from "./resolveAttachments.js";
import { userMessage, imagePart, filePart } from "../classes/message/index.js";

const opts = { provider: "openai", maxBytes: 20 * 1024 * 1024, audioFormats: ["mp3", "wav"] };

describe("resolveMessageAttachments — providerFile", () => {
  const g = { kind: "providerFile", provider: "google", id: "files/a", uri: "u", mimeType: "application/pdf" } as const;
  const oa = { kind: "providerFile", provider: "openai", id: "file-1", mimeType: "application/pdf" } as const;
  const oaImg = { kind: "providerFile", provider: "openai", id: "file-1", mimeType: "image/png" } as const;
  const call = (msgs: any[], provider: string) =>
    resolveMessageAttachments(msgs, { provider, maxBytes: 20 * 1024 * 1024, audioFormats: [] });

  it("passes a matching google ref through untouched", async () => {
    const res = await call([userMessage([filePart(g)])], "google");
    expect(res.success).toBe(true);
    if (res.success) expect((res.value[0] as any).getContentParts()[0].source).toEqual(g);
  });
  it("accepts an openai ref on an openai-responses call (same family)", async () => {
    expect((await call([userMessage([filePart(oa)])], "openai-responses")).success).toBe(true);
  });
  it("accepts a non-image openai ref on the openai Chat path", async () => {
    expect((await call([userMessage([filePart(oa)])], "openai")).success).toBe(true);
  });
  it("accepts anthropic-on-anthropic and google-on-google", async () => {
    expect((await call([userMessage([filePart({ kind: "providerFile", provider: "anthropic", id: "f" })])], "anthropic")).success).toBe(true);
    expect((await call([userMessage([filePart(g)])], "google")).success).toBe(true);
  });
  it("fails a provider-family mismatch with a message", async () => {
    const res = await call([userMessage([filePart(g)])], "openai-responses");
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/file family/i);
  });
  it("fails a providerFile on a no-files provider (openrouter)", async () => {
    expect((await call([userMessage([filePart(oa)])], "openrouter")).success).toBe(false);
  });
  it("fails an image providerFile on the openai Chat path (responses-only)", async () => {
    const res = await call([userMessage([imagePart(oaImg)])], "openai");
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/openai-responses/);
  });
  it("resolves mixed attachments: providerFile passes through while a bytes image normalizes", async () => {
    const res = await call([userMessage([filePart(oa), imagePart({ kind: "bytes", data: new Uint8Array([1]), mimeType: "image/png" })])], "openai-responses");
    expect(res.success).toBe(true);
    if (res.success) {
      const parts = (res.value[0] as any).getContentParts();
      expect(parts[0].source).toEqual(oa);
      expect(parts[1].source.kind).toBe("base64");
    }
  });
});

describe("acceptsRemoteUrl", () => {
  it("accepts image URLs for openai and anthropic, not google/ollama", () => {
    expect(acceptsRemoteUrl("openai", "image")).toBe(true);
    expect(acceptsRemoteUrl("openrouter", "image")).toBe(true);
    expect(acceptsRemoteUrl("anthropic", "image")).toBe(true);
    expect(acceptsRemoteUrl("google", "image")).toBe(false);
    expect(acceptsRemoteUrl("ollama", "image")).toBe(false);
  });

  it("accepts pdf URLs only for openai-responses and anthropic", () => {
    expect(acceptsRemoteUrl("anthropic", "file")).toBe(true);
    expect(acceptsRemoteUrl("openai-responses", "file")).toBe(true);
    expect(acceptsRemoteUrl("openai", "file")).toBe(false);
  });
});

describe("resolveMessageAttachments", () => {
  it("passes through string messages unchanged", async () => {
    const msgs = [userMessage("hi")];
    const res = await resolveMessageAttachments(msgs, opts);
    expect(res.success).toBe(true);
    if (res.success) expect(res.value[0]).toBe(msgs[0]);
  });

  it("keeps a url image ref as-is when the provider accepts URLs (no download)", async () => {
    const res = await resolveMessageAttachments(
      [userMessage([imagePart({ kind: "url", url: "https://x/y.png" })])],
      opts,
    );
    expect(res.success).toBe(true);
    if (res.success) {
      const part: any = (res.value[0] as any)._content[0];
      expect(part.source).toEqual({ kind: "url", url: "https://x/y.png" });
    }
  });

  it("resolves a bytes image ref to base64", async () => {
    const data = new Uint8Array([1, 2, 3]);
    const res = await resolveMessageAttachments(
      [userMessage(["look", imagePart({ kind: "bytes", data, mimeType: "image/png" })])],
      opts,
    );
    expect(res.success).toBe(true);
    if (res.success) {
      const part: any = (res.value[0] as any)._content[1];
      expect(part.source.kind).toBe("base64");
      expect(part.source.base64).toBe(Buffer.from(data).toString("base64"));
    }
  });

  it("fails when an attachment exceeds maxBytes", async () => {
    const data = new Uint8Array(100);
    const res = await resolveMessageAttachments(
      [userMessage([imagePart({ kind: "bytes", data, mimeType: "image/png" })])],
      { provider: "openai", maxBytes: 10, audioFormats: [] },
    );
    expect(res.success).toBe(false);
  });

  it("returns a failure when a path cannot be read", async () => {
    const res = await resolveMessageAttachments(
      [userMessage(["x", imagePart({ kind: "path", path: "/nonexistent/nope.png" })])],
      opts,
    );
    expect(res.success).toBe(false);
  });

  it("resolves a pdf file part to base64, preserving filename and text", async () => {
    const data = new Uint8Array([1, 2, 3]);
    const res = await resolveMessageAttachments(
      [userMessage(["read this", filePart({ kind: "bytes", data, mimeType: "application/pdf" }, { filename: "r.pdf" })])],
      opts,
    );
    expect(res.success).toBe(true);
    if (res.success) {
      const parts: any[] = (res.value[0] as any)._content;
      expect(parts[0]).toEqual({ type: "text", text: "read this" });
      expect(parts[1]).toEqual({
        type: "file",
        source: { kind: "base64", base64: Buffer.from(data).toString("base64"), mimeType: "application/pdf" },
        filename: "r.pdf",
      });
    }
  });

  it("downloads a url image for a provider that needs bytes (google)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([9, 9, 9]), { headers: { "content-type": "image/png" } }),
    );
    const res = await resolveMessageAttachments(
      [userMessage([imagePart({ kind: "url", url: "https://x/y.png" })])],
      { provider: "google", maxBytes: 20 * 1024 * 1024, audioFormats: [] },
    );
    expect(res.success).toBe(true);
    if (res.success) {
      const part: any = (res.value[0] as any)._content[0];
      expect(part.source.kind).toBe("base64");
      expect(part.source.mimeType).toBe("image/png");
    }
  });

  it("resolves multiple attachments in one message", async () => {
    const res = await resolveMessageAttachments(
      [
        userMessage([
          imagePart({ kind: "bytes", data: new Uint8Array([1]), mimeType: "image/png" }),
          imagePart({ kind: "bytes", data: new Uint8Array([2]), mimeType: "image/png" }),
        ]),
      ],
      opts,
    );
    expect(res.success).toBe(true);
    if (res.success) {
      const parts: any[] = (res.value[0] as any)._content;
      expect(parts).toHaveLength(2);
      expect(parts.every((p) => p.source.kind === "base64")).toBe(true);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
