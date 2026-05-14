import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./image/openai.js", () => ({
  openaiImage: vi.fn().mockResolvedValue({
    success: true,
    value: {
      images: [{ data: new Uint8Array([1]), mimeType: "image/png" }],
      model: "gpt-image-1",
    },
  }),
}));

vi.mock("./image/google.js", () => ({
  googleImage: vi.fn().mockResolvedValue({
    success: true,
    value: {
      images: [{ data: new Uint8Array([2]), mimeType: "image/png" }],
      model: "gemini-2.5-flash-image-preview",
    },
  }),
}));

import { image } from "./image.js";
import { openaiImage } from "./image/openai.js";
import { googleImage } from "./image/google.js";

describe("image", () => {
  beforeEach(() => vi.clearAllMocks());

  it("dispatches to OpenAI for OpenAI image models", async () => {
    await image("a cat", { model: "gpt-image-1", openAiApiKey: "k" });
    expect(openaiImage).toHaveBeenCalled();
    expect(googleImage).not.toHaveBeenCalled();
  });

  it("dispatches to Google for Gemini image models", async () => {
    await image("a cat", {
      model: "gemini-2.5-flash-image-preview",
      googleApiKey: "k",
    });
    expect(googleImage).toHaveBeenCalled();
    expect(openaiImage).not.toHaveBeenCalled();
  });

  it("forwards object-form input through unchanged", async () => {
    await image(
      {
        prompt: "edit",
        images: [
          { kind: "bytes", data: new Uint8Array([1]), mimeType: "image/png" },
        ],
      },
      { model: "gpt-image-1", openAiApiKey: "k" },
    );
    expect(openaiImage).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "edit" }),
      expect.anything(),
      "k",
    );
  });

  it("returns failure for unsupported provider", async () => {
    const r = await image("a cat", { model: "x", provider: "anthropic" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("does not support image generation");
    }
  });

  it("rejects mask for non-OpenAI providers", async () => {
    const r = await image(
      {
        prompt: "edit",
        images: [
          { kind: "bytes", data: new Uint8Array([1]), mimeType: "image/png" },
        ],
        mask: {
          kind: "bytes",
          data: new Uint8Array([2]),
          mimeType: "image/png",
        },
      },
      { model: "gemini-2.5-flash-image-preview", googleApiKey: "k" },
    );
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("mask");
      expect(r.error).toContain("OpenAI");
    }
    expect(googleImage).not.toHaveBeenCalled();
  });

  it("returns failure for missing API key", async () => {
    const orig = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const r = await image("a cat", { model: "gpt-image-1" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("API key");
    if (orig !== undefined) process.env.OPENAI_API_KEY = orig;
  });
});
