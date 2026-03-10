import { describe, it, expect } from "vitest";
import { getClient, registerProvider } from "./client.js";
import { BaseClient } from "./clients/baseClient.js";
import { PromptConfig, PromptResult, promptResult, success } from "./types.js";
import { Result } from "./types/result.js";

describe("getClient", () => {
  it("throws on unrecognized model name", () => {
    expect(() => getClient({ model: "nonexistent-model" as any })).toThrow(
      /not recognized/,
    );
  });

  it("throws on missing OpenAI API key", () => {
    expect(() => getClient({ model: "gpt-4o" })).toThrow(/No OpenAI API key/);
  });

  it("throws on missing OpenAI API key for openai-responses provider", () => {
    expect(() =>
      getClient({ model: "gpt-4o", provider: "openai-responses" }),
    ).toThrow(/No OpenAI API key/);
  });

  it("throws on missing Google API key", () => {
    expect(() => getClient({ model: "gemini-2.5-flash" })).toThrow(
      /No Google API key/,
    );
  });

  it("throws on unsupported provider", () => {
    expect(() => getClient({ model: "gpt-4o", provider: "replicate" })).toThrow(
      /not supported/,
    );
  });

  /*   it("resolves a ModelConfig to a concrete model", () => {
    // Should not throw "not recognized" - proves ModelConfig resolution works
    expect(() =>
      getClient({
        model: { optimizeFor: ["cost"], providers: ["openai"] },
        openAiApiKey: "test-key",
      }),
    ).not.toThrow();
  }); */

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

describe("registerProvider", () => {
  class EchoClient extends BaseClient {
    async _textSync(config: PromptConfig): Promise<Result<PromptResult>> {
      return success(promptResult({ output: "echo" }));
    }
  }

  it("allows registering a custom provider class", () => {
    registerProvider("echo", EchoClient);
    const client = getClient({ model: "any-model", provider: "echo" as any });
    expect(client).toBeInstanceOf(EchoClient);
  });

  it("throws for unregistered provider", () => {
    expect(() =>
      getClient({ model: "any-model", provider: "not-registered" as any }),
    ).toThrow(/not supported/);
  });

  it("registered provider is used when model specifies it", () => {
    registerProvider("echo2", EchoClient);
    const client = getClient({ model: "my-model", provider: "echo2" as any });
    expect(client).toBeDefined();
  });
});
