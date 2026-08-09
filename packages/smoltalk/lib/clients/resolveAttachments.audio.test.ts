import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { messagesHaveAttachments, resolveMessageAttachments } from "./resolveAttachments.js";
import { UserMessage } from "../classes/message/index.js";

const mk = (mime: string) =>
  new UserMessage([{ type: "audio", source: { kind: "base64", base64: "AAAA", mimeType: mime } }]);

describe("audio attachment resolution", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("detects audio parts", () => {
    expect(messagesHaveAttachments([mk("audio/wav")])).toBe(true);
  });

  it("converts exact bytes to exact base64", async () => {
    const message = new UserMessage([
      {
        type: "audio",
        source: { kind: "bytes", data: new Uint8Array([1, 2, 3]), mimeType: "audio/wav" },
        filename: "clip.wav",
      },
    ]);
    const r = await resolveMessageAttachments([message], { provider: "openai", maxBytes: 1_000_000 });
    expect(r.success).toBe(true);
    if (!r.success) {
      throw new Error(r.error);
    }
    const part = (r.value[0] as UserMessage).getContentParts()![0];
    expect(part).toEqual({
      type: "audio",
      source: { kind: "base64", base64: "AQID", mimeType: "audio/wav" },
      filename: "clip.wav",
    });
  });

  it("fails during preparation for a non-mp3/wav chat MIME", async () => {
    const r = await resolveMessageAttachments([mk("audio/ogg")], { provider: "openai", maxBytes: 1_000_000 });
    expect(r.success).toBe(false);
  });

  describe("path and URL sources", () => {
    let dir: string | null = null;

    afterEach(async () => {
      if (dir !== null) {
        await rm(dir, { recursive: true, force: true });
        dir = null;
      }
    });

    it("infers the exact MIME and base64 for a .wav path with no explicit mimeType", async () => {
      dir = await mkdtemp(join(tmpdir(), "smoltalk-audio-"));
      const filePath = join(dir, "clip.wav");
      const bytes = new Uint8Array([9, 8, 7]);
      await writeFile(filePath, bytes);
      const message = new UserMessage([{ type: "audio", source: { kind: "path", path: filePath } }]);
      const r = await resolveMessageAttachments([message], { provider: "openai", maxBytes: 1_000_000 });
      expect(r.success).toBe(true);
      if (!r.success) {
        throw new Error(r.error);
      }
      const part = (r.value[0] as UserMessage).getContentParts()![0];
      expect(part).toEqual({
        type: "audio",
        source: { kind: "base64", base64: Buffer.from(bytes).toString("base64"), mimeType: "audio/wav" },
      });
    });

    it("infers the exact MIME and base64 for a .mp3 path with no explicit mimeType", async () => {
      dir = await mkdtemp(join(tmpdir(), "smoltalk-audio-"));
      const filePath = join(dir, "clip.mp3");
      const bytes = new Uint8Array([5, 4, 3]);
      await writeFile(filePath, bytes);
      const message = new UserMessage([{ type: "audio", source: { kind: "path", path: filePath } }]);
      const r = await resolveMessageAttachments([message], { provider: "openai", maxBytes: 1_000_000 });
      expect(r.success).toBe(true);
      if (!r.success) {
        throw new Error(r.error);
      }
      const part = (r.value[0] as UserMessage).getContentParts()![0];
      expect(part).toEqual({
        type: "audio",
        source: { kind: "base64", base64: Buffer.from(bytes).toString("base64"), mimeType: "audio/mpeg" },
      });
    });

    it("resolves a mocked audio URL to fetched bytes/MIME as base64, with no URL in the result", async () => {
      const bytes = new Uint8Array([1, 1, 2, 3]);
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(bytes, { headers: { "content-type": "audio/mpeg" } }),
      );
      const message = new UserMessage([
        { type: "audio", source: { kind: "url", url: "https://example.com/clip.mp3" } },
      ]);
      const r = await resolveMessageAttachments([message], { provider: "openai", maxBytes: 1_000_000 });
      expect(r.success).toBe(true);
      if (!r.success) {
        throw new Error(r.error);
      }
      const part = (r.value[0] as UserMessage).getContentParts()![0] as any;
      expect(part.source.kind).toBe("base64");
      expect(part.source.mimeType).toBe("audio/mpeg");
      expect(part.source.base64).toBe(Buffer.from(bytes).toString("base64"));
      expect(JSON.stringify(part)).not.toContain("https://example.com/clip.mp3");
    });
  });

  it("rejects an attachment that exceeds maxBytes with the exact error", async () => {
    const data = new Uint8Array(100);
    const message = new UserMessage([{ type: "audio", source: { kind: "bytes", data, mimeType: "audio/wav" } }]);
    const r = await resolveMessageAttachments([message], { provider: "openai", maxBytes: 10 });
    expect(r.success).toBe(false);
    if (r.success) {
      throw new Error("expected failure");
    }
    expect(r.error).toBe(
      'Failed to load audio attachment: Attachment exceeds the maximum size of 10 bytes (got 100 bytes).',
    );
  });
});
