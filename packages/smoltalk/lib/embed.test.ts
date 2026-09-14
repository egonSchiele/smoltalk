import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const loaderState = vi.hoisted(() => ({
  fail: undefined as Error | undefined,
  withEmbed: true,
  calls: 0,
}));

vi.mock("./clients/llamaCppLoader.js", () => ({
  loadLlamaCpp: vi.fn(async () => {
    loaderState.calls += 1;
    if (loaderState.fail) {
      throw loaderState.fail;
    }
    if (!loaderState.withEmbed) {
      return {};
    }
    return {
      embed: async (inputs: string[]) => ({
        success: true,
        value: { embeddings: inputs.map(() => [0.1]), model: "/m/model.gguf" },
      }),
    };
  }),
}));

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

vi.mock("./embed/mlx.js", () => ({
  mlxEmbed: vi.fn().mockResolvedValue({
    success: true,
    value: {
      embeddings: [[0.7, 0.8]],
      model: "mlx-community/Qwen3-Embedding-4B-4bit-DWQ",
    },
  }),
}));

import {
  embed,
  registerEmbeddingProvider,
  hasEmbeddingProvider,
  unregisterEmbeddingProvider,
} from "./embed.js";
import { openaiEmbed } from "./embed/openai.js";
import { googleEmbed } from "./embed/google.js";
import { ollamaEmbed } from "./embed/ollama.js";
import { mlxEmbed } from "./embed/mlx.js";

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

  it("dispatches to openaiEmbed for deepinfra with baked baseURL", async () => {
    await embed(["hello"], {
      model: "BAAI/bge-small-en-v1.5",
      provider: "deepinfra",
      apiKey: { deepInfra: "k" },
    });
    expect(openaiEmbed).toHaveBeenCalledWith(
      ["hello"],
      expect.anything(),
      "k",
      "https://api.deepinfra.com/v1/openai",
    );
  });

  it("dispatches to openaiEmbed for litellm with user baseURL", async () => {
    await embed(["hello"], {
      model: "text-embedding-3-small",
      provider: "litellm",
      apiKey: { liteLlm: "k" },
      baseUrl: { liteLlm: "http://localhost:4000" },
    });
    expect(openaiEmbed).toHaveBeenCalledWith(
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

  it("dispatches to openaiEmbed for openai-compat", async () => {
    await embed(["hello"], {
      model: "any/model",
      provider: "openai-compat",
      apiKey: { openAiCompat: "k" },
      baseUrl: { openAiCompat: "https://h.test/v1" },
    });
    expect(openaiEmbed).toHaveBeenCalledWith(
      ["hello"],
      expect.anything(),
      "k",
      "https://h.test/v1",
    );
  });

  it("dispatches to the MLX server for provider mlx, with the default base URL", async () => {
    const saved = process.env.MLX_BASE_URL;
    delete process.env.MLX_BASE_URL;
    try {
      await embed(["hello"], {
        model: "mlx-community/Qwen3-Embedding-4B-4bit-DWQ",
        provider: "mlx",
      });
    } finally {
      if (saved !== undefined) {
        process.env.MLX_BASE_URL = saved;
      }
    }
    expect(mlxEmbed).toHaveBeenCalledWith(
      ["hello"],
      expect.objectContaining({ provider: "mlx" }),
      "http://127.0.0.1:8080/v1",
    );
  });

  it("reports and removes a registered embed provider", async () => {
    expect(hasEmbeddingProvider("custom-x")).toBe(false);
    registerEmbeddingProvider("custom-x", async () => ({
      success: true,
      value: { embeddings: [[1]], model: "custom" },
    }));
    expect(hasEmbeddingProvider("custom-x")).toBe(true);
    expect(unregisterEmbeddingProvider("custom-x")).toBe(true);
    expect(unregisterEmbeddingProvider("custom-x")).toBe(false);
    expect(hasEmbeddingProvider("custom-x")).toBe(false);
  });

  it("uses baseUrl.mlx when it is set", async () => {
    await embed(["hello"], {
      model: "x/y",
      provider: "mlx",
      baseUrl: { mlx: "http://127.0.0.1:9000/v1" },
    });
    expect(mlxEmbed).toHaveBeenCalledWith(
      ["hello"],
      expect.anything(),
      "http://127.0.0.1:9000/v1",
    );
  });

  describe("llama-cpp", () => {
    beforeEach(() => {
      loaderState.fail = undefined;
      loaderState.withEmbed = true;
      loaderState.calls = 0;
      unregisterEmbeddingProvider("llama-cpp");
    });
    afterEach(() => {
      unregisterEmbeddingProvider("llama-cpp");
    });

    it("loads the plugin and uses its embed function", async () => {
      const result = await embed("hello", { provider: "llama-cpp", model: "/m/model.gguf" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.model).toBe("/m/model.gguf");
      }
      expect(loaderState.calls).toBe(1);
    });

    it("surfaces the loader's install hint when the plugin is missing", async () => {
      loaderState.fail = new Error(
        "The llama-cpp provider needs the optional smoltalk-llama-cpp package. Install it (npm i smoltalk-llama-cpp) and try again.",
      );
      const result = await embed("hello", { provider: "llama-cpp", model: "/m/model.gguf" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("npm i smoltalk-llama-cpp");
      }
    });

    it("says the plugin is too old when it loads but has no embed", async () => {
      loaderState.withEmbed = false;
      const result = await embed("hello", { provider: "llama-cpp", model: "/m/model.gguf" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("smoltalk-llama-cpp@latest");
        expect(result.error).toContain("0.5.0");
      }
    });

    it("prefers a hand-registered llama-cpp embed provider and does not load", async () => {
      registerEmbeddingProvider("llama-cpp", async () => ({
        success: true,
        value: { embeddings: [[9]], model: "mine" },
      }));
      const result = await embed("hello", { provider: "llama-cpp", model: "/m/model.gguf" });
      expect(result.success && result.value.model).toBe("mine");
      expect(loaderState.calls).toBe(0);
    });
  });
});
