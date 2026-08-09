import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ModelDataBlob } from "./modelData.js";
import { getLogger } from "./util/logger.js";
import { registerModelData, clearModelData } from "./models.js";

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

import {
  transcribe,
  getTranscriptionClient,
  registerTranscriptionProvider,
  _resetForTests,
} from "./transcription.js";
import type { TranscriptionResult } from "./transcription.js";
import {
  BaseTranscriptionClient,
  TranscriptionClientConfig,
} from "./transcription/baseTranscriptionClient.js";
import { OpenAITranscriptionClient } from "./transcription/openai.js";
import { Result, success } from "./types/result.js";

beforeEach(() => {
  _resetForTests();
  create.mockReset();
});
afterEach(() => {
  clearModelData();
});
const src = { kind: "base64" as const, base64: "AAAA", mimeType: "audio/wav" };

describe("transcribe() dispatch", () => {
  it("rejects a wrong-capability model", async () => {
    const r = await transcribe(src, { model: "gpt-4o-mini", provider: "openai", apiKey: { openAi: "sk-x" } });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("not a speech-to-text model");
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
    const errorSpy = vi.spyOn(getLogger(), "error").mockImplementation(() => {});
    const r = await transcribe(src, { model: "totally-unknown-model" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("not recognized");
    }
    errorSpy.mockRestore();
  });

  it("rejects an unregistered custom provider", async () => {
    const r = await transcribe(src, { model: "custom-1", provider: "someprovider" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("has no transcription API");
      expect(r.error).toContain("registerTranscriptionProvider(name, ClientClass)");
    }
  });

  it("dispatches an unknown model to a registered custom provider", async () => {
    class MyAsr extends BaseTranscriptionClient {
      protected async _transcribe(): Promise<Result<TranscriptionResult>> {
        return success({ text: "hi" });
      }
    }
    registerTranscriptionProvider("myasr", MyAsr);
    const r = await transcribe(src, { model: "custom-1", provider: "myasr" });
    expect(r.success).toBe(true);
  });

  it("passes exact bytes, mime type, and resolved config to a custom provider", async () => {
    let seenData: Uint8Array | undefined;
    let seenMime: string | undefined;
    let seenConfig: TranscriptionClientConfig | undefined;
    class MyAsr extends BaseTranscriptionClient {
      protected async _transcribe(data: Uint8Array, mimeType: string): Promise<Result<TranscriptionResult>> {
        seenData = data;
        seenMime = mimeType;
        seenConfig = this.config;
        return success({ text: "hi" });
      }
    }
    registerTranscriptionProvider("myasr", MyAsr);
    const r = await transcribe(src, {
      model: "custom-1",
      provider: "myasr",
      apiKey: { openAi: "sk-should-not-appear", ollama: "ollama-key" },
      language: "en",
    });
    expect(r.success).toBe(true);
    expect(seenData).toBeInstanceOf(Uint8Array);
    expect(seenMime).toBe("audio/wav");
    expect(seenConfig).toEqual({
      model: "custom-1",
      provider: "myasr",
      language: "en",
      apiKey: "",
    });
  });

  it("passes a custom provider's apiKey, keyed by its exact registered name, through to config.apiKey", async () => {
    let seenKey: string | undefined;
    class Acme extends BaseTranscriptionClient {
      protected async _transcribe(): Promise<Result<TranscriptionResult>> {
        seenKey = this.config.apiKey;
        return success({ text: "hi" });
      }
    }
    registerTranscriptionProvider("acme", Acme);
    const r = await transcribe(src, {
      model: "custom-1",
      provider: "acme",
      apiKey: { acme: "secret-123" },
    });
    expect(r.success).toBe(true);
    expect(seenKey).toBe("secret-123");
  });

  it("does not let a registered provider override the built-in openai handling", async () => {
    class Hijack extends BaseTranscriptionClient {
      protected async _transcribe(): Promise<Result<TranscriptionResult>> {
        return success({ text: "hijacked" });
      }
    }
    registerTranscriptionProvider("openai", Hijack);
    const client = getTranscriptionClient({ model: "whisper-1", provider: "openai", apiKey: { openAi: "sk-x" } });
    expect(client.success).toBe(true);
    if (client.success) {
      expect(client.value).toBeInstanceOf(OpenAITranscriptionClient);
    }
  });

  it("converts a synchronous provider throw into a Failure and logs one redacted error", async () => {
    class Boom extends BaseTranscriptionClient {
      protected _transcribe(): Promise<Result<TranscriptionResult>> {
        throw new Error("kaboom");
      }
    }
    registerTranscriptionProvider("boom", Boom);
    const errorSpy = vi.spyOn(getLogger(), "error").mockImplementation(() => {});
    const r = await transcribe(src, { model: "x", provider: "boom" });
    expect(r.success).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("converts a rejected provider promise into a Failure and logs one redacted error", async () => {
    class Rej extends BaseTranscriptionClient {
      protected async _transcribe(): Promise<Result<TranscriptionResult>> {
        return Promise.reject(new Error("nope"));
      }
    }
    registerTranscriptionProvider("rej", Rej);
    const errorSpy = vi.spyOn(getLogger(), "error").mockImplementation(() => {});
    const r = await transcribe(src, { model: "x", provider: "rej" });
    expect(r.success).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("converts a throwing custom constructor into a redacted Failure from both the factory and transcribe()", async () => {
    class EvilCtor extends BaseTranscriptionClient {
      constructor(config: TranscriptionClientConfig) {
        super(config);
        throw new Error(`boom ${config.apiKey}`);
      }
      protected async _transcribe(): Promise<Result<TranscriptionResult>> {
        return success({ text: "unreachable" });
      }
    }
    registerTranscriptionProvider("evil", EvilCtor);
    const errorSpy = vi.spyOn(getLogger(), "error").mockImplementation(() => {});

    const viaFactory = getTranscriptionClient({
      model: "custom-1",
      provider: "evil",
      apiKey: { evil: "sk-secret-xyz" },
    });
    expect(viaFactory.success).toBe(false);
    if (!viaFactory.success) {
      expect(viaFactory.error).not.toContain("sk-secret-xyz");
      expect(viaFactory.error).toContain("[redacted]");
    }
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0].join(" ")).not.toContain("sk-secret-xyz");

    const viaTranscribe = await transcribe(src, {
      model: "custom-1",
      provider: "evil",
      apiKey: { evil: "sk-secret-xyz" },
    });
    expect(viaTranscribe.success).toBe(false);
    if (!viaTranscribe.success) {
      expect(viaTranscribe.error).not.toContain("sk-secret-xyz");
    }
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

  it("lets injected modelData declare a new STT model under openai (registry is the allowlist)", async () => {
    const md = {
      schemaVersion: 1,
      generatedAt: "t",
      hostedTools: [],
      models: [{ type: "speech-to-text", modelName: "custom-1", provider: "openai", perMinuteCost: 0.006 }],
    } satisfies ModelDataBlob;
    create.mockResolvedValue({ text: "ok" });
    const r = await transcribe(src, {
      model: "custom-1",
      provider: "openai",
      apiKey: { openAi: "sk-x" },
      modelData: md,
    });
    expect(r.success).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("redacts the RESOLVED provider's key (not an openai guess) when provider is inferred from the model", async () => {
    const secret = "google-secret-abc123";
    const md = {
      schemaVersion: 1,
      generatedAt: "t",
      hostedTools: [],
      models: [{ type: "speech-to-text", modelName: "custom-google-model", provider: "google" }],
    } satisfies ModelDataBlob;
    class GoogleAsr extends BaseTranscriptionClient {
      protected async _transcribe(): Promise<Result<TranscriptionResult>> {
        throw new Error(`upstream rejected request signed with ${secret}`);
      }
    }
    registerTranscriptionProvider("google", GoogleAsr);
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

describe("model-data-driven validation", () => {
  it("rejects an unsupported MIME type for whisper-1", async () => {
    const r = await transcribe(
      { kind: "base64", base64: "AAAA", mimeType: "audio/aiff" },
      { model: "whisper-1", provider: "openai", apiKey: { openAi: "sk-x" } },
    );
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("Unsupported audio type");
    }
    expect(create).not.toHaveBeenCalled();
  });

  const aliasCases = [
    { mimeType: "audio/mp3", canonical: "audio/mpeg" },
    { mimeType: "audio/x-wav", canonical: "audio/wav" },
    { mimeType: "audio/x-m4a", canonical: "audio/m4a" },
    { mimeType: "video/mp4", canonical: "audio/mp4" },
  ];
  for (const { mimeType, canonical } of aliasCases) {
    it(`normalizes the ${mimeType} alias to ${canonical} before the allowlist check`, async () => {
      create.mockResolvedValue({ text: "ok" });
      const r = await transcribe(
        { kind: "base64", base64: "AAAA", mimeType },
        { model: "whisper-1", provider: "openai", apiKey: { openAi: "sk-x" } },
      );
      expect(r.success).toBe(true);
      expect(create).toHaveBeenCalledTimes(1);
    });
  }
});

describe("maxBytes cap resolution", () => {
  function cappedModelData(maxBytes: unknown): ModelDataBlob {
    return {
      schemaVersion: 1,
      generatedAt: "t",
      hostedTools: [],
      models: [
        { type: "speech-to-text", modelName: "capped-model", provider: "capped", maxBytes },
      ],
    } as unknown as ModelDataBlob;
  }

  let reached: boolean;
  class CappedAsr extends BaseTranscriptionClient {
    protected async _transcribe(): Promise<Result<TranscriptionResult>> {
      reached = true;
      return success({ text: "ok" });
    }
  }
  beforeEach(() => {
    reached = false;
    registerTranscriptionProvider("capped", CappedAsr);
  });

  const bytes200 = { kind: "bytes" as const, data: new Uint8Array(200), mimeType: "audio/wav" };

  it("uses the caller limit when it is below the model cap", async () => {
    const source60 = { kind: "bytes" as const, data: new Uint8Array(60), mimeType: "audio/wav" };
    const r = await transcribe(source60, {
      model: "capped-model",
      provider: "capped",
      modelData: cappedModelData(100),
      maxBytes: 50,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("Failed to load audio for transcription");
    }
    expect(reached).toBe(false);
  });

  it("a caller limit above the model cap cannot bypass it", async () => {
    const r = await transcribe(bytes200, {
      model: "capped-model",
      provider: "capped",
      modelData: cappedModelData(100),
      maxBytes: 1000,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("Failed to load audio for transcription");
    }
    expect(reached).toBe(false);
  });

  it("applies the model cap when the caller sets no limit", async () => {
    const r = await transcribe(bytes200, {
      model: "capped-model",
      provider: "capped",
      modelData: cappedModelData(100),
    });
    expect(r.success).toBe(false);
    expect(reached).toBe(false);
  });

  it("enforces a cap supplied through global registerModelData", async () => {
    registerModelData(cappedModelData(100));
    const r = await transcribe(bytes200, { model: "capped-model", provider: "capped" });
    expect(r.success).toBe(false);
    expect(reached).toBe(false);
  });

  it("rejects a non-positive caller maxBytes", async () => {
    const r = await transcribe(src, {
      model: "capped-model",
      provider: "capped",
      modelData: cappedModelData(100),
      maxBytes: -1,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("maxBytes must be a positive finite number");
    }
  });

  const badCaps: Array<{ label: string; value: unknown }> = [
    { label: 'parsed string "invalid"', value: "invalid" },
    { label: "NaN", value: NaN },
    { label: "Infinity", value: Infinity },
  ];
  for (const { label, value } of badCaps) {
    it(`rejects model data with a ${label} maxBytes before blob loading`, async () => {
      const r = await transcribe(bytes200, {
        model: "capped-model",
        provider: "capped",
        modelData: cappedModelData(value),
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error).toContain('has an invalid maxBytes value');
      }
      expect(reached).toBe(false);
    });
  }

  it("rejects model data with non-string supportedMimeTypes entries", async () => {
    const md = {
      schemaVersion: 1,
      generatedAt: "t",
      hostedTools: [],
      models: [
        { type: "speech-to-text", modelName: "capped-model", provider: "capped", supportedMimeTypes: [42] },
      ],
    } as unknown as ModelDataBlob;
    const r = await transcribe(src, { model: "capped-model", provider: "capped", modelData: md });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("has invalid supportedMimeTypes");
    }
    expect(reached).toBe(false);
  });
});
