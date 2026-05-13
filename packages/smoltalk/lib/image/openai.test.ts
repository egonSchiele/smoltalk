import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGenerate = vi.fn();
const mockEdit = vi.fn();

vi.mock("openai", () => {
  function MockOpenAI(this: any) {
    this.images = { generate: mockGenerate, edit: mockEdit };
  }
  return { __esModule: true, default: MockOpenAI };
});

vi.mock("openai/uploads", () => ({
  toFile: vi
    .fn()
    .mockImplementation(async (data: any, name: string, opts: any) => ({
      name,
      type: opts?.type,
      data,
    })),
}));

import { openaiImage } from "./openai.js";

describe("openaiImage", () => {
  beforeEach(() => {
    mockGenerate.mockReset();
    mockEdit.mockReset();
    mockGenerate.mockResolvedValue({
      data: [{ b64_json: Buffer.from([1, 2, 3]).toString("base64") }],
      usage: {
        input_tokens: 10,
        output_tokens: 100,
        input_tokens_details: { cached_tokens: 0 },
      },
    });
  });

  it("returns generated image bytes for text-only prompt", async () => {
    const r = await openaiImage("a cat", { model: "gpt-image-1" }, "test-key");
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.value.images).toHaveLength(1);
      expect(Array.from(r.value.images[0].data)).toEqual([1, 2, 3]);
      expect(r.value.images[0].mimeType).toBe("image/png");
      expect(r.value.tokenUsage?.inputTokens).toBe(10);
      expect(r.value.tokenUsage?.outputTokens).toBe(100);
      expect(r.value.costEstimate).toBeDefined();
    }
    expect(mockGenerate).toHaveBeenCalled();
    expect(mockEdit).not.toHaveBeenCalled();
  });

  it("passes n, size, quality through", async () => {
    await openaiImage(
      "a cat",
      { model: "gpt-image-1", n: 2, size: "1024x1024", quality: "high" },
      "test-key",
    );
    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ n: 2, size: "1024x1024", quality: "high" }),
    );
  });

  it("uses images.edit when reference images are present", async () => {
    mockEdit.mockResolvedValueOnce({
      data: [{ b64_json: Buffer.from([9]).toString("base64") }],
    });
    const r = await openaiImage(
      {
        prompt: "make it green",
        images: [
          { kind: "bytes", data: new Uint8Array([1]), mimeType: "image/png" },
        ],
      },
      { model: "gpt-image-1" },
      "test-key",
    );
    expect(r.success).toBe(true);
    expect(mockEdit).toHaveBeenCalled();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("returns failure on API error", async () => {
    mockGenerate.mockRejectedValueOnce(new Error("rate limit"));
    const r = await openaiImage("a cat", { model: "gpt-image-1" }, "test-key");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("rate limit");
  });
});
