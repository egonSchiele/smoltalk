import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveProvider, resolveApiKey } from "./provider.js";

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
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("prefers config key over env var", () => {
    process.env.OPENAI_API_KEY = "env-key";
    expect(resolveApiKey("openai", { openAiApiKey: "config-key" })).toBe(
      "config-key",
    );
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

  it("resolves Anthropic key", () => {
    expect(
      resolveApiKey("anthropic", { anthropicApiKey: "anth-key" }),
    ).toBe("anth-key");
  });

  it("handles openai-responses same as openai", () => {
    expect(
      resolveApiKey("openai-responses", { openAiApiKey: "key" }),
    ).toBe("key");
  });

  it("returns ollamaApiKey for ollama provider", () => {
    expect(resolveApiKey("ollama", { ollamaApiKey: "olla-key" })).toBe(
      "olla-key",
    );
  });

  it("returns undefined for unknown provider", () => {
    expect(resolveApiKey("unknown", {})).toBeUndefined();
  });
});
