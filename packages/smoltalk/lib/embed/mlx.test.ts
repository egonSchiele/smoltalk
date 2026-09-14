import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();

vi.mock("openai", () => {
  function MockOpenAI(this: any, options: { apiKey: string; baseURL?: string }) {
    (MockOpenAI as any).lastOptions = options;
    this.embeddings = { create: mockCreate };
  }
  return { __esModule: true, default: MockOpenAI };
});

import OpenAI from "openai";
import { mlxEmbed } from "./mlx.js";

describe("mlxEmbed", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({
      data: [{ embedding: [0.1, 0.2], index: 0 }],
      model: "mlx-community/Qwen3-Embedding-4B-4bit-DWQ",
      usage: { prompt_tokens: 3, total_tokens: 3 },
    });
  });

  it("posts to the given base URL with the fixed local key", async () => {
    const result = await mlxEmbed(
      ["hello"],
      { model: "mlx-community/Qwen3-Embedding-4B-4bit-DWQ" },
      "http://127.0.0.1:9000/v1",
    );
    expect(result.success).toBe(true);
    expect((OpenAI as any).lastOptions).toEqual({
      apiKey: "mlx-local",
      baseURL: "http://127.0.0.1:9000/v1",
    });
    expect(mockCreate).toHaveBeenCalledWith({
      model: "mlx-community/Qwen3-Embedding-4B-4bit-DWQ",
      input: ["hello"],
      encoding_format: "float",
    });
  });

  it("reports zero cost and the token count the server returned", async () => {
    const result = await mlxEmbed(["hello"], { model: "x/y" }, "http://127.0.0.1:8080/v1");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.embeddings).toEqual([[0.1, 0.2]]);
      expect(result.value.tokenUsage).toEqual({ inputTokens: 3, outputTokens: 0 });
      expect(result.value.costEstimate).toEqual({
        inputCost: 0,
        outputCost: 0,
        totalCost: 0,
        currency: "USD",
      });
    }
  });

  it("returns a failure naming the server when the request fails", async () => {
    mockCreate.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await mlxEmbed(["hello"], { model: "x/y" }, "http://127.0.0.1:8080/v1");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("ECONNREFUSED");
    }
  });
});
