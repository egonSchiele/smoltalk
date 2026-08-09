import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ModelDataBlob } from "./modelData.js";
import { getLogger } from "./util/logger.js";

const create = vi.fn();
vi.mock("openai", () => {
  class OpenAI {
    audio = { transcriptions: { create } };
    constructor(_: any) {}
  }
  return {
    default: OpenAI,
    toFile: async (data: any, name: string, o: any) => ({ data, name, type: o?.type }),
  };
});

import { transcribe, registerTranscriptionProvider, _resetForTests } from "./transcription.js";

beforeEach(() => {
  _resetForTests();
  create.mockReset();
});
const src = { kind: "base64" as const, base64: "AAAA", mimeType: "audio/wav" };

describe("transcribe() dispatch", () => {
  it("rejects an OpenAI model outside the allowlist", async () => {
    const r = await transcribe(src, { model: "gpt-4o-transcribe", provider: "openai", apiKey: { openAi: "sk-x" } });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("not a supported OpenAI transcription model");
    }
  });

  it("rejects a wrong-capability model", async () => {
    const r = await transcribe(src, { model: "gpt-4o-mini", provider: "openai", apiKey: { openAi: "sk-x" } });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("not a supported OpenAI transcription model");
    }
  });

  it("rejects when no API key is provided for openai", async () => {
    const original = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const r = await transcribe(src, { model: "whisper-1", provider: "openai" });
    if (original !== undefined) {
      process.env.OPENAI_API_KEY = original;
    }
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("No OpenAI API key provided");
    }
  });

  it("fails to resolve an unknown model with no explicit provider", async () => {
    const r = await transcribe(src, { model: "totally-unknown-model" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("not recognized");
    }
  });

  it("rejects an unregistered custom provider", async () => {
    const r = await transcribe(src, { model: "custom-1", provider: "someprovider" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("has no transcription API");
    }
  });

  it("dispatches an unknown model to a registered custom provider", async () => {
    registerTranscriptionProvider("myasr", { async transcribe() { return { success: true, value: { text: "hi" } }; } });
    const r = await transcribe(src, { model: "custom-1", provider: "myasr" });
    expect(r.success).toBe(true);
  });

  it("passes exact bytes, mime type, resolved key, and options to a custom provider", async () => {
    let seenData: Uint8Array | undefined;
    let seenMime: string | undefined;
    let seenCtx: unknown;
    registerTranscriptionProvider("myasr", {
      async transcribe(data, mimeType, ctx) {
        seenData = data;
        seenMime = mimeType;
        seenCtx = ctx;
        return { success: true, value: { text: "hi" } };
      },
    });
    const r = await transcribe(src, {
      model: "custom-1",
      provider: "myasr",
      apiKey: { openAi: "sk-should-not-appear", ollama: "ollama-key" },
      language: "en",
    });
    expect(r.success).toBe(true);
    expect(seenData).toBeInstanceOf(Uint8Array);
    expect(seenMime).toBe("audio/wav");
    expect(seenCtx).toEqual({
      apiKey: "",
      opts: { model: "custom-1", provider: "myasr", language: "en" },
    });
  });

  it("does not let a registered provider override the built-in openai handling", async () => {
    registerTranscriptionProvider("openai", { async transcribe() { return { success: true, value: { text: "hijacked" } }; } });
    const r = await transcribe(src, { model: "gpt-4o-transcribe", provider: "openai", apiKey: { openAi: "sk-x" } });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("not a supported OpenAI transcription model");
    }
  });

  it("converts a synchronous provider throw into a Failure and logs one redacted error", async () => {
    registerTranscriptionProvider("boom", {
      transcribe() {
        throw new Error("kaboom");
      },
    });
    const errorSpy = vi.spyOn(getLogger(), "error").mockImplementation(() => {});
    const r = await transcribe(src, { model: "x", provider: "boom" });
    expect(r.success).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("converts a rejected provider promise into a Failure and logs one redacted error", async () => {
    registerTranscriptionProvider("rej", { async transcribe() { return Promise.reject(new Error("nope")); } });
    const errorSpy = vi.spyOn(getLogger(), "error").mockImplementation(() => {});
    const r = await transcribe(src, { model: "x", provider: "rej" });
    expect(r.success).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("fails to load an oversize blob before dispatching", async () => {
    const bigBase64 = "A".repeat(1000);
    const r = await transcribe(
      { kind: "base64", base64: bigBase64, mimeType: "audio/wav" },
      { model: "whisper-1", provider: "openai", apiKey: { openAi: "sk-x" }, maxBytes: 10 },
    );
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("Failed to load audio for transcription");
    }
  });

  it("does not let injected modelData bypass the OpenAI allowlist", async () => {
    const md = {
      schemaVersion: 1,
      generatedAt: "t",
      hostedTools: [],
      models: [{ type: "speech-to-text", modelName: "custom-1", provider: "openai", perMinuteCost: 0.006 }],
    } satisfies ModelDataBlob;
    const r = await transcribe(src, {
      model: "custom-1",
      provider: "openai",
      apiKey: { openAi: "sk-x" },
      modelData: md,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("not a supported OpenAI transcription model");
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("redacts the RESOLVED provider's key (not an openai guess) when provider is inferred from the model", async () => {
    const secret = "google-secret-abc123";
    const md = {
      schemaVersion: 1,
      generatedAt: "t",
      hostedTools: [],
      models: [{ type: "speech-to-text", modelName: "custom-google-model", provider: "google" }],
    } satisfies ModelDataBlob;
    registerTranscriptionProvider("google", {
      async transcribe() {
        throw new Error(`upstream rejected request signed with ${secret}`);
      },
    });
    const errorSpy = vi.spyOn(getLogger(), "error").mockImplementation(() => {});
    const r = await transcribe(src, {
      model: "custom-google-model",
      modelData: md,
      apiKey: { google: secret },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).not.toContain(secret);
      expect(r.error).toContain("[redacted]");
    }
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const loggedArgs = errorSpy.mock.calls[0];
    expect(loggedArgs.join(" ")).not.toContain(secret);
    errorSpy.mockRestore();
  });

  it("converts a rejected OpenAI SDK promise into a single redacted, logged Failure", async () => {
    create.mockRejectedValue(new Error("upstream exploded near sk-x"));
    const errorSpy = vi.spyOn(getLogger(), "error").mockImplementation(() => {});
    const r = await transcribe(src, { model: "whisper-1", provider: "openai", apiKey: { openAi: "sk-x" } });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).not.toContain("sk-x");
      expect(r.error).toContain("[redacted]");
    }
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const loggedArgs = errorSpy.mock.calls[0];
    expect(loggedArgs.join(" ")).not.toContain("sk-x");
    errorSpy.mockRestore();
  });
});
