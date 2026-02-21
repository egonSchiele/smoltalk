import { describe, it, expect } from "vitest";
import { getClient } from "./client.js";

describe("getClient", () => {
  it("throws on unrecognized model name", () => {
    expect(() =>
      getClient({ model: "nonexistent-model" as any }),
    ).toThrow(/not recognized/);
  });

  it("throws on missing OpenAI API key", () => {
    expect(() =>
      getClient({ model: "gpt-4o" }),
    ).toThrow(/No OpenAI API key/);
  });

  it("throws on missing OpenAI API key for openai-responses provider", () => {
    expect(() =>
      getClient({ model: "gpt-4o", provider: "openai-responses" }),
    ).toThrow(/No OpenAI API key/);
  });

  it("throws on missing Google API key", () => {
    expect(() =>
      getClient({ model: "gemini-2.5-flash" }),
    ).toThrow(/No Google API key/);
  });

  it("throws on unsupported provider", () => {
    expect(() =>
      getClient({ model: "gpt-4o", provider: "replicate" }),
    ).toThrow(/not supported/);
  });

  it("resolves a ModelConfig to a concrete model", () => {
    // Should not throw "not recognized" - proves ModelConfig resolution works
    expect(() =>
      getClient({
        model: { optimizeFor: ["cost"], providers: ["openai"] },
        openAiApiKey: "test-key",
      }),
    ).not.toThrow();
  });

  it("creates a client with a valid openai config", () => {
    const client = getClient({
      model: "gpt-4o",
      openAiApiKey: "test-key",
    });
    expect(client).toBeDefined();
  });

  it("creates a client with a valid google config", () => {
    const client = getClient({
      model: "gemini-2.5-flash",
      googleApiKey: "test-key",
    });
    expect(client).toBeDefined();
  });

  it("creates an ollama client without API keys", () => {
    const client = getClient({
      model: "deepseek-r1:8b",
    });
    expect(client).toBeDefined();
  });
});
