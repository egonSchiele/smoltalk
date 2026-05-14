import { describe, it, expect, vi, beforeEach } from "vitest";
import { googleImage } from "./google.js";

// vi.mock calls are hoisted by vitest above any imports.
const mockGenerateContent = vi.fn();

vi.mock("@google/genai", () => {
  function MockGoogleGenAI(this: any) {
    this.models = { generateContent: mockGenerateContent };
  }
  return { __esModule: true, GoogleGenAI: MockGoogleGenAI };
});

describe("googleImage", () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
    mockGenerateContent.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: "image/png",
                  data: Buffer.from([1, 2, 3]).toString("base64"),
                },
              },
            ],
          },
        },
      ],
    });
  });

  it("returns generated image bytes for text-only prompt", async () => {
    const r = await googleImage(
      "a cat",
      { model: "gemini-2.5-flash-image-preview" },
      "test-key",
    );
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.value.images).toHaveLength(1);
      expect(Array.from(r.value.images[0].data)).toEqual([1, 2, 3]);
      expect(r.value.images[0].mimeType).toBe("image/png");
    }
  });

  it("includes reference images as inlineData parts", async () => {
    await googleImage(
      {
        prompt: "make green",
        images: [
          { kind: "bytes", data: new Uint8Array([9]), mimeType: "image/jpeg" },
        ],
      },
      { model: "gemini-2.5-flash-image-preview" },
      "test-key",
    );
    const call = mockGenerateContent.mock.calls[0][0];
    const parts = call.contents[0].parts;
    expect(parts.some((p: any) => p.text === "make green")).toBe(true);
    expect(
      parts.some(
        (p: any) =>
          p.inlineData?.mimeType === "image/jpeg" && p.inlineData?.data,
      ),
    ).toBe(true);
  });

  it("collects images from all candidates, not just the first", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: "image/png",
                  data: Buffer.from([1]).toString("base64"),
                },
              },
            ],
          },
        },
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: "image/png",
                  data: Buffer.from([2]).toString("base64"),
                },
              },
            ],
          },
        },
      ],
    });
    const r = await googleImage(
      "two cats",
      { model: "gemini-2.5-flash-image-preview" },
      "test-key",
    );
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.value.images).toHaveLength(2);
      expect(Array.from(r.value.images[0].data)).toEqual([1]);
      expect(Array.from(r.value.images[1].data)).toEqual([2]);
    }
  });

  it("returns failure on API error", async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error("quota exceeded"));
    const r = await googleImage(
      "a cat",
      { model: "gemini-2.5-flash-image-preview" },
      "test-key",
    );
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("quota exceeded");
  });
});
