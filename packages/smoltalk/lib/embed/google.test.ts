import { describe, it, expect, vi, beforeEach } from "vitest";

const mockEmbedContent = vi.fn();

vi.mock("@google/genai", () => {
  function MockGoogleGenAI(this: any) {
    this.models = { embedContent: mockEmbedContent };
  }
  return { __esModule: true, GoogleGenAI: MockGoogleGenAI };
});

import { googleEmbed } from "./google.js";

describe("googleEmbed", () => {
  beforeEach(() => {
    mockEmbedContent.mockReset();
    mockEmbedContent.mockResolvedValue({
      embeddings: [
        { values: [0.1, 0.2, 0.3] },
        { values: [0.4, 0.5, 0.6] },
      ],
    });
  });

  it("returns embeddings for batch input", async () => {
    const result = await googleEmbed(
      ["hello", "world"],
      { model: "gemini-embedding-001" },
      "test-api-key",
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.embeddings).toHaveLength(2);
      expect(result.value.embeddings[0]).toEqual([0.1, 0.2, 0.3]);
      expect(result.value.embeddings[1]).toEqual([0.4, 0.5, 0.6]);
      expect(result.value.model).toBe("gemini-embedding-001");
    }
  });

  it("passes outputDimensionality when dimensions is specified", async () => {
    await googleEmbed(
      ["hello"],
      { model: "gemini-embedding-001", dimensions: 256 },
      "test-api-key",
    );

    expect(mockEmbedContent).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ outputDimensionality: 256 }),
      }),
    );
  });

  it("returns failure on API error", async () => {
    mockEmbedContent.mockRejectedValueOnce(new Error("quota exceeded"));

    const result = await googleEmbed(
      ["hello"],
      { model: "gemini-embedding-001" },
      "test-api-key",
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("quota exceeded");
    }
  });
});
