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
