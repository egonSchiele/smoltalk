import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./embed/openai.js", () => ({
  openaiEmbed: vi.fn().mockResolvedValue({
    success: true,
    value: {
      embeddings: [[0.1, 0.2]],
      model: "text-embedding-3-small",
      tokenUsage: { inputTokens: 5, outputTokens: 0 },
    },
  }),
}));

vi.mock("./embed/google.js", () => ({
  googleEmbed: vi.fn().mockResolvedValue({
    success: true,
    value: {
      embeddings: [[0.3, 0.4]],
      model: "gemini-embedding-001",
    },
  }),
}));

vi.mock("./embed/ollama.js", () => ({
  ollamaEmbed: vi.fn().mockResolvedValue({
    success: true,
    value: {
      embeddings: [[0.5, 0.6]],
      model: "nomic-embed-text",
    },
  }),
}));

vi.mock("./embed/openaiCompat.js", () => ({
  openaiCompatEmbed: vi.fn().mockResolvedValue({
    success: true,
    value: {
      embeddings: [[0.7, 0.8]],
      model: "compat-model",
    },
  }),
}));

import { embed } from "./embed.js";
import { openaiEmbed } from "./embed/openai.js";
import { googleEmbed } from "./embed/google.js";
import { ollamaEmbed } from "./embed/ollama.js";
import { openaiCompatEmbed } from "./embed/openaiCompat.js";

describe("embed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes single string input to array", async () => {
    const result = await embed("hello", {
      model: "text-embedding-3-small",
      apiKey: { openAi: "test-key" },
    });

    expect(result.success).toBe(true);
    expect(openaiEmbed).toHaveBeenCalledWith(
      ["hello"],
      expect.anything(),
      "test-key",
    );
  });

  it("dispatches to OpenAI for OpenAI models", async () => {
    await embed(["hello"], {
      model: "text-embedding-3-small",
      apiKey: { openAi: "test-key" },
    });

    expect(openaiEmbed).toHaveBeenCalled();
    expect(googleEmbed).not.toHaveBeenCalled();
  });

  it("dispatches to Google for Gemini models", async () => {
    await embed(["hello"], {
      model: "gemini-embedding-001",
      apiKey: { google: "test-key" },
    });

    expect(googleEmbed).toHaveBeenCalled();
    expect(openaiEmbed).not.toHaveBeenCalled();
  });

  it("dispatches to Ollama when provider is explicitly set", async () => {
    await embed(["hello"], {
      model: "nomic-embed-text",
      provider: "ollama",
    });

    expect(ollamaEmbed).toHaveBeenCalled();
  });

  it("returns failure for unsupported provider", async () => {
    const result = await embed(["hello"], {
      model: "some-model",
      provider: "anthropic",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("does not support embeddings");
    }
  });

  it("returns failure for missing API key", async () => {
    const orig = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const result = await embed(["hello"], {
      model: "text-embedding-3-small",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("API key");
    }

    if (orig !== undefined) process.env.OPENAI_API_KEY = orig;
  });

  it("returns failure for openrouter (no embeddings endpoint)", async () => {
    const result = await embed(["hello"], {
      model: "any",
      provider: "openrouter",
      apiKey: { openRouter: "k" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/openrouter.*embedd/i);
    }
  });

  it("dispatches to openaiCompatEmbed for deepinfra with baked baseURL", async () => {
    await embed(["hello"], {
      model: "BAAI/bge-small-en-v1.5",
      provider: "deepinfra",
      apiKey: { deepInfra: "k" },
    });
    expect(openaiCompatEmbed).toHaveBeenCalledWith(
      ["hello"],
      expect.anything(),
      "k",
      "https://api.deepinfra.com/v1/openai",
    );
  });

  it("dispatches to openaiCompatEmbed for litellm with user baseURL", async () => {
    await embed(["hello"], {
      model: "text-embedding-3-small",
      provider: "litellm",
      apiKey: { liteLlm: "k" },
      baseUrl: { liteLlm: "http://localhost:4000" },
    });
    expect(openaiCompatEmbed).toHaveBeenCalledWith(
      ["hello"],
      expect.anything(),
      "k",
      "http://localhost:4000",
    );
  });

  it("litellm without base URL returns failure", async () => {
    const orig = process.env.LITELLM_BASE_URL;
    delete process.env.LITELLM_BASE_URL;
    const result = await embed(["hello"], {
      model: "text-embedding-3-small",
      provider: "litellm",
      apiKey: { liteLlm: "k" },
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/base URL/i);
    if (orig !== undefined) process.env.LITELLM_BASE_URL = orig;
  });

  it("dispatches to openaiCompatEmbed for openai-compat", async () => {
    await embed(["hello"], {
      model: "any/model",
      provider: "openai-compat",
      apiKey: { openAiCompat: "k" },
      baseUrl: { openAiCompat: "https://h.test/v1" },
    });
    expect(openaiCompatEmbed).toHaveBeenCalledWith(
      ["hello"],
      expect.anything(),
      "k",
      "https://h.test/v1",
    );
  });
});
