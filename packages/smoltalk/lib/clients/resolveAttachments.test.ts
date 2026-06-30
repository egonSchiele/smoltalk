import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveMessageAttachments, acceptsRemoteUrl } from "./resolveAttachments.js";
import { userMessage, imagePart, filePart } from "../classes/message/index.js";

const opts = { provider: "openai", maxBytes: 20 * 1024 * 1024 };

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
      { provider: "openai", maxBytes: 10 },
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
      { provider: "google", maxBytes: 20 * 1024 * 1024 },
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
