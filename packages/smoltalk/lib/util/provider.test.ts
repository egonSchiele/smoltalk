import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveProvider, resolveApiKey, resolveBaseUrl } from "./provider.js";

describe("resolveProvider", () => {
  it("returns explicit provider when given", () => {
    expect(resolveProvider("any-model", "openai")).toBe("openai");
  });

  it("resolves provider from registered text model", () => {
    expect(resolveProvider("gpt-4o-mini")).toBe("openai");
  });

  it("resolves provider from registered embeddings model", () => {
    expect(resolveProvider("text-embedding-3-small")).toBe("openai");
    expect(resolveProvider("gemini-embedding-001")).toBe("google");
  });

  it("throws for unrecognized model without explicit provider", () => {
    expect(() => resolveProvider("nonexistent-model")).toThrow(
      /not recognized/,
    );
  });
});

describe("resolveApiKey", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.DEEPINFRA_API_KEY;
    delete process.env.LITELLM_API_KEY;
    delete process.env.OPENAI_COMPAT_API_KEY;
    delete process.env.GROQ_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("reads keys from the nested apiKey map", () => {
    expect(resolveApiKey("openai", { apiKey: { openAi: "sk-1" } })).toBe(
      "sk-1",
    );
    expect(
      resolveApiKey("anthropic", { apiKey: { anthropic: "an-1" } }),
    ).toBe("an-1");
  });

  it("prefers config key over env var", () => {
    process.env.OPENAI_API_KEY = "env-key";
    expect(
      resolveApiKey("openai", { apiKey: { openAi: "config-key" } }),
    ).toBe("config-key");
  });

  it("falls back to env var when config key is missing", () => {
    process.env.OPENAI_API_KEY = "env-key";
    expect(resolveApiKey("openai", {})).toBe("env-key");
  });

  it("returns undefined when no key is available", () => {
    expect(resolveApiKey("openai", {})).toBeUndefined();
  });

  it("resolves Google key from GEMINI_API_KEY env var", () => {
    process.env.GEMINI_API_KEY = "gemini-key";
    expect(resolveApiKey("google", {})).toBe("gemini-key");
  });

  it("handles openai-responses same as openai", () => {
    expect(
      resolveApiKey("openai-responses", { apiKey: { openAi: "key" } }),
    ).toBe("key");
  });

  it("returns ollama key for ollama provider (no env fallback)", () => {
    expect(
      resolveApiKey("ollama", { apiKey: { ollama: "olla-key" } }),
    ).toBe("olla-key");
    expect(resolveApiKey("ollama", {})).toBeUndefined();
  });

  it("resolves openrouter / deepinfra / litellm / openai-compat", () => {
    expect(
      resolveApiKey("openrouter", { apiKey: { openRouter: "or-1" } }),
    ).toBe("or-1");
    expect(
      resolveApiKey("deepinfra", { apiKey: { deepInfra: "di-1" } }),
    ).toBe("di-1");
    expect(
      resolveApiKey("litellm", { apiKey: { liteLlm: "ll-1" } }),
    ).toBe("ll-1");
    expect(
      resolveApiKey("openai-compat", { apiKey: { openAiCompat: "oc-1" } }),
    ).toBe("oc-1");

    process.env.OPENROUTER_API_KEY = "or-env";
    process.env.DEEPINFRA_API_KEY = "di-env";
    process.env.LITELLM_API_KEY = "ll-env";
    process.env.OPENAI_COMPAT_API_KEY = "oc-env";
    expect(resolveApiKey("openrouter", {})).toBe("or-env");
    expect(resolveApiKey("deepinfra", {})).toBe("di-env");
    expect(resolveApiKey("litellm", {})).toBe("ll-env");
    expect(resolveApiKey("openai-compat", {})).toBe("oc-env");
  });

  it("resolves the groq key from config then GROQ_API_KEY", () => {
    expect(resolveApiKey("groq", { apiKey: { groq: "gk-explicit" } })).toBe(
      "gk-explicit",
    );
    process.env.GROQ_API_KEY = "gk-env";
    expect(resolveApiKey("groq", {})).toBe("gk-env");
  });

  it("no longer reads the old flat fields", () => {
    // @ts-expect-error flat field removed from the type
    expect(resolveApiKey("openai", { openAiApiKey: "sk-old" })).toBeUndefined();
  });

  it("returns undefined for unknown provider", () => {
    expect(resolveApiKey("unknown", {})).toBeUndefined();
  });
});

describe("resolveBaseUrl", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.OLLAMA_HOST;
    delete process.env.LITELLM_BASE_URL;
    delete process.env.OPENAI_COMPAT_BASE_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns baked default for openrouter and deepinfra", () => {
    expect(resolveBaseUrl("openrouter", {})).toBe(
      "https://openrouter.ai/api/v1",
    );
    expect(resolveBaseUrl("deepinfra", {})).toBe(
      "https://api.deepinfra.com/v1/openai",
    );
  });

  it("config override beats baked default", () => {
    expect(
      resolveBaseUrl("openrouter", {
        baseUrl: { openRouter: "https://proxy.test/v1" },
      }),
    ).toBe("https://proxy.test/v1");
  });

  it("returns undefined when litellm/openai-compat URL is missing", () => {
    expect(resolveBaseUrl("litellm", {})).toBeUndefined();
    expect(resolveBaseUrl("openai-compat", {})).toBeUndefined();
  });

  it("falls back to env vars for litellm and openai-compat", () => {
    process.env.LITELLM_BASE_URL = "http://litellm.local:4000";
    process.env.OPENAI_COMPAT_BASE_URL = "http://compat.local/v1";
    expect(resolveBaseUrl("litellm", {})).toBe("http://litellm.local:4000");
    expect(resolveBaseUrl("openai-compat", {})).toBe("http://compat.local/v1");
  });

  it("ollama reads config then OLLAMA_HOST", () => {
    expect(
      resolveBaseUrl("ollama", { baseUrl: { ollama: "http://ol.test" } }),
    ).toBe("http://ol.test");
    process.env.OLLAMA_HOST = "http://envhost:11434";
    expect(resolveBaseUrl("ollama", {})).toBe("http://envhost:11434");
  });

  it("returns undefined for unknown provider", () => {
    expect(resolveBaseUrl("unknown", {})).toBeUndefined();
  });
});
