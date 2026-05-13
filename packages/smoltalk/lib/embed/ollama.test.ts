import { describe, it, expect, vi, beforeEach } from "vitest";

const mockEmbed = vi.fn();

vi.mock("ollama", () => {
  function MockOllama(this: any) {
    this.embed = mockEmbed;
  }
  return { __esModule: true, Ollama: MockOllama };
});

import { ollamaEmbed } from "./ollama.js";

describe("ollamaEmbed", () => {
  beforeEach(() => {
    mockEmbed.mockReset();
    mockEmbed.mockResolvedValue({
      model: "nomic-embed-text",
      embeddings: [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ],
      prompt_eval_count: 4,
      total_duration: 0,
      load_duration: 0,
    });
  });

  it("returns embeddings for batch input", async () => {
    const result = await ollamaEmbed(["hello", "world"], {
      model: "nomic-embed-text",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.embeddings).toHaveLength(2);
      expect(result.value.embeddings[0]).toEqual([0.1, 0.2, 0.3]);
      expect(result.value.model).toBe("nomic-embed-text");
      expect(result.value.tokenUsage?.inputTokens).toBe(4);
    }
  });

  it("passes dimensions when specified", async () => {
    await ollamaEmbed(["hello"], {
      model: "nomic-embed-text",
      dimensions: 256,
    });

    expect(mockEmbed).toHaveBeenCalledWith(
      expect.objectContaining({ dimensions: 256 }),
    );
  });

  it("returns failure on API error", async () => {
    mockEmbed.mockRejectedValueOnce(new Error("connection refused"));

    const result = await ollamaEmbed(["hello"], {
      model: "nomic-embed-text",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("connection refused");
    }
  });
});
