import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();

vi.mock("openai", () => {
  function MockOpenAI(this: any) {
    this.embeddings = { create: mockCreate };
  }
  return { __esModule: true, default: MockOpenAI };
});

import { openaiEmbed } from "./openai.js";

describe("openaiEmbed", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({
      data: [
        { embedding: [0.1, 0.2, 0.3], index: 0 },
        { embedding: [0.4, 0.5, 0.6], index: 1 },
      ],
      model: "text-embedding-3-small",
      usage: { prompt_tokens: 10, total_tokens: 10 },
    });
  });

  it("returns embeddings for batch input", async () => {
    const result = await openaiEmbed(
      ["hello", "world"],
      { model: "text-embedding-3-small" },
      "test-api-key",
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.embeddings).toHaveLength(2);
      expect(result.value.embeddings[0]).toEqual([0.1, 0.2, 0.3]);
      expect(result.value.embeddings[1]).toEqual([0.4, 0.5, 0.6]);
      expect(result.value.model).toBe("text-embedding-3-small");
      expect(result.value.tokenUsage?.inputTokens).toBe(10);
      expect(result.value.costEstimate).toBeDefined();
      expect(result.value.costEstimate?.currency).toBe("USD");
    }
  });

  it("passes dimensions when specified", async () => {
    await openaiEmbed(
      ["hello"],
      { model: "text-embedding-3-small", dimensions: 256 },
      "test-api-key",
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ dimensions: 256 }),
    );
  });

  it("leaves the encoding to the SDK default for OpenAI itself", async () => {
    await openaiEmbed(["hello"], { model: "text-embedding-3-small" }, "k");
    const body = mockCreate.mock.calls[0][0];
    expect(body.encoding_format).toBeUndefined();
  });

  it("requests float encoding for any custom base URL", async () => {
    await openaiEmbed(
      ["hello"],
      { model: "some/model" },
      "k",
      "https://compat.test/v1",
    );
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ encoding_format: "float" }),
    );
  });

  it("lets an explicit encodingFormat override the base URL rule", async () => {
    await openaiEmbed(
      ["hello"],
      { model: "some/model" },
      "k",
      "https://compat.test/v1",
      { encodingFormat: "base64" },
    );
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ encoding_format: "base64" }),
    );
  });

  it("decodes a base64 embedding the server sent despite a float request", async () => {
    const floats = new Float32Array([0.25, -1.5, 3]);
    const base64 = Buffer.from(floats.buffer).toString("base64");
    mockCreate.mockResolvedValueOnce({
      data: [{ embedding: base64, index: 0 }],
      model: "some/model",
      usage: { prompt_tokens: 3, total_tokens: 3 },
    });

    const result = await openaiEmbed(
      ["hello"],
      { model: "some/model" },
      "k",
      "https://compat.test/v1",
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.embeddings).toEqual([[0.25, -1.5, 3]]);
    }
  });

  it("returns failure on API error", async () => {
    mockCreate.mockRejectedValueOnce(new Error("rate limit"));

    const result = await openaiEmbed(
      ["hello"],
      { model: "text-embedding-3-small" },
      "test-api-key",
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("rate limit");
    }
  });
});
