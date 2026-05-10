import { describe, it, expect } from "vitest";
import { getClient, registerProvider } from "./client.js";
import { BaseClient } from "./clients/baseClient.js";
import { SmolConfig, PromptResult, promptResult, success } from "./types.js";
import { Result } from "./types/result.js";

describe("getClient", () => {
  it("throws on unrecognized model name", () => {
    expect(() => getClient({ model: "nonexistent-model" as any })).toThrow(
      /not recognized/,
    );
  });

  it("throws on missing OpenAI API key", () => {
    const orig = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      expect(() => getClient({ model: "gpt-4o" })).toThrow(/No OpenAI API key/);
    } finally {
      if (orig !== undefined) process.env.OPENAI_API_KEY = orig;
    }
  });

  it("throws on missing OpenAI API key for openai-responses provider", () => {
    const orig = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      expect(() =>
        getClient({ model: "gpt-4o", provider: "openai-responses" }),
      ).toThrow(/No OpenAI API key/);
    } finally {
      if (orig !== undefined) process.env.OPENAI_API_KEY = orig;
    }
  });

  it("throws on missing Google API key", () => {
    const orig = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      expect(() => getClient({ model: "gemini-2.5-flash" })).toThrow(
        /No Google API key/,
      );
    } finally {
      if (orig !== undefined) process.env.GEMINI_API_KEY = orig;
    }
  });

  it("uses OPENAI_API_KEY env var when no key provided in config", () => {
    const orig = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "env-test-key";
    try {
      expect(() => getClient({ model: "gpt-4o" })).not.toThrow();
    } finally {
      if (orig !== undefined) process.env.OPENAI_API_KEY = orig;
      else delete process.env.OPENAI_API_KEY;
    }
  });

  it("uses GEMINI_API_KEY env var when no key provided in config", () => {
    const orig = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "env-test-key";
    try {
      expect(() => getClient({ model: "gemini-2.5-flash" })).not.toThrow();
    } finally {
      if (orig !== undefined) process.env.GEMINI_API_KEY = orig;
      else delete process.env.GEMINI_API_KEY;
    }
  });

  it("uses ANTHROPIC_API_KEY env var when no key provided in config", () => {
    const orig = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "env-test-key";
    try {
      expect(() =>
        getClient({ model: "claude-sonnet-4-6" }),
      ).not.toThrow();
    } finally {
      if (orig !== undefined) process.env.ANTHROPIC_API_KEY = orig;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("throws on unsupported provider", () => {
    expect(() => getClient({ model: "gpt-4o", provider: "replicate" })).toThrow(
      /not supported/,
    );
  });

  it("creates a client without requiring messages (SmolClientConfig contract)", () => {
    // getClient is for constructing clients — messages are a per-call concern
    // supplied later via client.text({ messages }). Tightening this back to
    // SmolConfig would force callers to pass dummy messages.
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
      provider: "ollama",
    });
    expect(client).toBeDefined();
  });
});

describe("registerProvider", () => {
  class EchoClient extends BaseClient {
    async _textSync(config: SmolConfig): Promise<Result<PromptResult>> {
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

  it("re-registering the same name replaces the previous class", () => {
    class FirstClient extends BaseClient {
      async _textSync(): Promise<Result<PromptResult>> {
        return success(promptResult({ output: "first" }));
      }
    }
    class SecondClient extends BaseClient {
      async _textSync(): Promise<Result<PromptResult>> {
        return success(promptResult({ output: "second" }));
      }
    }
    registerProvider("replace-test", FirstClient);
    registerProvider("replace-test", SecondClient);
    const client = getClient({
      model: "any-model",
      provider: "replace-test" as any,
    });
    expect(client).toBeInstanceOf(SecondClient);
    expect(client).not.toBeInstanceOf(FirstClient);
  });

  it("constructs the registered class with the smolConfig", () => {
    let captured: any = null;
    class CapturingClient extends BaseClient {
      constructor(config: any) {
        super(config);
        captured = config;
      }
      async _textSync(): Promise<Result<PromptResult>> {
        return success(promptResult({ output: "x" }));
      }
    }
    registerProvider("capturing", CapturingClient);
    getClient({
      model: "any-model",
      provider: "capturing" as any,
      openAiApiKey: "captured-key",
    });
    expect(captured?.model).toBe("any-model");
    expect(captured?.openAiApiKey).toBe("captured-key");
  });
});
