import { describe, it, expect, vi, beforeEach } from "vitest";
import { openaiImage } from "./openai.js";

// Note: vi.mock calls are hoisted by vitest above any imports, so it is safe
// for them to appear after the import of the module under test.
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

  it("includes mask in images.edit when both images and mask are provided", async () => {
    mockEdit.mockResolvedValueOnce({
      data: [{ b64_json: Buffer.from([5]).toString("base64") }],
    });
    await openaiImage(
      {
        prompt: "inpaint",
        images: [
          { kind: "bytes", data: new Uint8Array([1]), mimeType: "image/png" },
        ],
        mask: { kind: "bytes", data: new Uint8Array([2]), mimeType: "image/png" },
      },
      { model: "gpt-image-1" },
      "test-key",
    );
    expect(mockEdit).toHaveBeenCalledWith(
      expect.objectContaining({ mask: expect.anything() }),
    );
  });

  it("rejects mask without any input images", async () => {
    const r = await openaiImage(
      {
        prompt: "inpaint",
        mask: { kind: "bytes", data: new Uint8Array([2]), mimeType: "image/png" },
      },
      { model: "gpt-image-1" },
      "test-key",
    );
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("mask was provided without");
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockEdit).not.toHaveBeenCalled();
  });

  it("splits image-input vs text-input tokens for cost when usage details present", async () => {
    mockGenerate.mockResolvedValueOnce({
      data: [{ b64_json: Buffer.from([1]).toString("base64") }],
      usage: {
        input_tokens: 1100,
        output_tokens: 1000,
        input_tokens_details: {
          cached_tokens: 0,
          text_tokens: 100,
          image_tokens: 1000,
        },
      },
    });
    const r = await openaiImage("a cat", { model: "gpt-image-1" }, "test-key");
    expect(r.success).toBe(true);
    if (r.success) {
      // 100 text * $5/M + 1000 image * $10/M = 0.0005 + 0.01 = 0.0105
      expect(r.value.costEstimate?.inputCost).toBeCloseTo(0.0105, 6);
      // 1000 image-out * $40/M = 0.04
      expect(r.value.costEstimate?.outputCost).toBeCloseTo(0.04, 6);
    }
  });
});
