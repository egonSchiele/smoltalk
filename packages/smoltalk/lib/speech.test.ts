import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ModelDataBlob } from "./modelData.js";
import { getLogger } from "./util/logger.js";

const create = vi.fn();
vi.mock("openai", () => {
  class OpenAI {
    audio = { speech: { create } };
    constructor(_: any) {}
  }
  return { default: OpenAI };
});

import { speak, getSpeechClient, registerSpeechProvider, _resetForTests } from "./speech.js";
import type { SpeechResult } from "./speech.js";
import { BaseSpeechClient, SpeechClientConfig } from "./speech/baseSpeechClient.js";
import { OpenAISpeechClient } from "./speech/openai.js";
import { Result, success } from "./types/result.js";

beforeEach(() => {
  _resetForTests();
  create.mockReset();
});

const okResponse = () => ({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });

function okSpeech(): Result<SpeechResult> {
  return success({ audio: new Uint8Array([1]), mimeType: "audio/mpeg" });
}

describe("speak() dispatch", () => {
  it("rejects out-of-range speed on the OpenAI branch", async () => {
    const r = await speak("hi", {
      model: "tts-1",
      voice: "alloy",
      speed: 9,
      provider: "openai",
      apiKey: { openAi: "sk-x" },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("speed must be a finite number in [0.25, 4]");
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects text over 4096 code points on the OpenAI branch", async () => {
    const input = "😀".repeat(4096) + "a";
    expect(input.length).not.toBe([...input].length);
    const r = await speak(input, { model: "tts-1", voice: "alloy", provider: "openai", apiKey: { openAi: "sk-x" } });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("4096-character limit");
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("accepts exactly 4096 code points, including astral input, on the OpenAI branch", async () => {
    create.mockResolvedValue(okResponse());
    const input = "😀".repeat(4096);
    expect([...input].length).toBe(4096);
    const r = await speak(input, { model: "tts-1", voice: "alloy", provider: "openai", apiKey: { openAi: "sk-x" } });
    expect(r.success).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("accepts the minimum and maximum OpenAI speed bounds", async () => {
    create.mockResolvedValue(okResponse());
    const rMin = await speak("hi", { model: "tts-1", voice: "alloy", speed: 0.25, provider: "openai", apiKey: { openAi: "sk-x" } });
    const rMax = await speak("hi", { model: "tts-1", voice: "alloy", speed: 4, provider: "openai", apiKey: { openAi: "sk-x" } });
    expect(rMin.success).toBe(true);
    expect(rMax.success).toBe(true);
  });

  it.each([NaN, Infinity, -Infinity, 0.24, 4.01])("rejects speed=%s on the OpenAI branch", async (speed) => {
    const r = await speak("hi", { model: "tts-1", voice: "alloy", speed, provider: "openai", apiKey: { openAi: "sk-x" } });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("speed must be a finite number");
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects when no API key is provided for openai", async () => {
    const original = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const r = await speak("hi", { model: "tts-1", voice: "alloy", provider: "openai" });
    if (original !== undefined) {
      process.env.OPENAI_API_KEY = original;
    }
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("No OpenAI API key provided");
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("fails to resolve an unknown model with no explicit provider", async () => {
    const errorSpy = vi.spyOn(getLogger(), "error").mockImplementation(() => {});
    const r = await speak("hi", { model: "totally-unknown-model", voice: "alloy" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("not recognized");
    }
    errorSpy.mockRestore();
  });

  it("rejects an unregistered custom provider", async () => {
    const r = await speak("hi", { model: "custom-1", voice: "v", provider: "someprovider" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("has no speech API");
      expect(r.error).toContain("registerSpeechProvider(name, ClientClass)");
    }
  });

  it("dispatches unknown model to a registered custom provider", async () => {
    class MyTts extends BaseSpeechClient {
      protected async _speak(): Promise<Result<SpeechResult>> {
        return okSpeech();
      }
    }
    registerSpeechProvider("mytts", MyTts);
    const r = await speak("hi", { model: "c1", voice: "v", provider: "mytts" });
    expect(r.success).toBe(true);
  });

  it("passes exact text and resolved config to a custom provider", async () => {
    let seenText: string | undefined;
    let seenConfig: SpeechClientConfig | undefined;
    class MyTts extends BaseSpeechClient {
      protected async _speak(text: string): Promise<Result<SpeechResult>> {
        seenText = text;
        seenConfig = this.config;
        return okSpeech();
      }
    }
    registerSpeechProvider("mytts", MyTts);
    const r = await speak("hello world", {
      model: "custom-1",
      voice: "v",
      provider: "mytts",
      apiKey: { openAi: "sk-should-not-appear", ollama: "ollama-key" },
    });
    expect(r.success).toBe(true);
    expect(seenText).toBe("hello world");
    expect(seenConfig).toEqual({
      model: "custom-1",
      voice: "v",
      provider: "mytts",
      apiKey: "",
    });
  });

  it("passes a custom provider's apiKey, keyed by its exact registered name, through to config.apiKey", async () => {
    let seenKey: string | undefined;
    class Acme extends BaseSpeechClient {
      protected async _speak(): Promise<Result<SpeechResult>> {
        seenKey = this.config.apiKey;
        return okSpeech();
      }
    }
    registerSpeechProvider("acme", Acme);
    const r = await speak("hi", {
      model: "custom-1",
      voice: "v",
      provider: "acme",
      apiKey: { acme: "secret-123" },
    });
    expect(r.success).toBe(true);
    expect(seenKey).toBe("secret-123");
  });

  it("does not subject a custom provider's unknown model to any model-data limits", async () => {
    class MyTts extends BaseSpeechClient {
      protected async _speak(): Promise<Result<SpeechResult>> {
        return okSpeech();
      }
    }
    registerSpeechProvider("mytts", MyTts);
    const input = "😀".repeat(4096) + "a";
    const r = await speak(input, { model: "custom-1", voice: "v", provider: "mytts", speed: 99 });
    expect(r.success).toBe(true);
  });

  it("does not let a registered provider override the built-in openai handling", async () => {
    class Hijack extends BaseSpeechClient {
      protected async _speak(): Promise<Result<SpeechResult>> {
        return okSpeech();
      }
    }
    registerSpeechProvider("openai", Hijack);
    const client = getSpeechClient({ model: "tts-1", voice: "alloy", provider: "openai", apiKey: { openAi: "sk-x" } });
    expect(client.success).toBe(true);
    if (client.success) {
      expect(client.value).toBeInstanceOf(OpenAISpeechClient);
    }
  });

  it("lets injected modelData declare a new TTS model under openai (registry is the allowlist)", async () => {
    const md = {
      schemaVersion: 1,
      generatedAt: "t",
      hostedTools: [],
      models: [{ type: "text-to-speech", modelName: "custom-1", provider: "openai", perCharacterCost: 0.00001 }],
    } satisfies ModelDataBlob;
    create.mockResolvedValue(okResponse());
    const r = await speak("hi", {
      model: "custom-1",
      voice: "alloy",
      provider: "openai",
      apiKey: { openAi: "sk-x" },
      modelData: md,
    });
    expect(r.success).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("converts a synchronous provider throw into a Failure and logs one redacted error", async () => {
    class Boom extends BaseSpeechClient {
      protected _speak(): Promise<Result<SpeechResult>> {
        throw new Error("kaboom");
      }
    }
    registerSpeechProvider("boom", Boom);
    const errorSpy = vi.spyOn(getLogger(), "error").mockImplementation(() => {});
    const r = await speak("hi", { model: "x", voice: "v", provider: "boom" });
    expect(r.success).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("converts a rejected provider promise into a Failure and logs one redacted error", async () => {
    class Rej extends BaseSpeechClient {
      protected async _speak(): Promise<Result<SpeechResult>> {
        return Promise.reject(new Error("nope"));
      }
    }
    registerSpeechProvider("rej", Rej);
    const errorSpy = vi.spyOn(getLogger(), "error").mockImplementation(() => {});
    const r = await speak("hi", { model: "x", voice: "v", provider: "rej" });
    expect(r.success).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("converts a throwing custom constructor into a redacted Failure from both the factory and speak()", async () => {
    class EvilCtor extends BaseSpeechClient {
      constructor(config: SpeechClientConfig) {
        super(config);
        throw new Error(`boom ${config.apiKey}`);
      }
      protected async _speak(): Promise<Result<SpeechResult>> {
        return okSpeech();
      }
    }
    registerSpeechProvider("evil", EvilCtor);
    const errorSpy = vi.spyOn(getLogger(), "error").mockImplementation(() => {});

    const viaFactory = getSpeechClient({
      model: "custom-1",
      voice: "v",
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

    const viaSpeak = await speak("hi", {
      model: "custom-1",
      voice: "v",
      provider: "evil",
      apiKey: { evil: "sk-secret-xyz" },
    });
    expect(viaSpeak.success).toBe(false);
    if (!viaSpeak.success) {
      expect(viaSpeak.error).not.toContain("sk-secret-xyz");
    }
    errorSpy.mockRestore();
  });

  it("converts a rejected OpenAI SDK promise into a single redacted, logged Failure", async () => {
    create.mockRejectedValue(new Error("upstream exploded near sk-x"));
    const errorSpy = vi.spyOn(getLogger(), "error").mockImplementation(() => {});
    const r = await speak("hi", { model: "tts-1", voice: "alloy", provider: "openai", apiKey: { openAi: "sk-x" } });
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

  it("redacts the RESOLVED provider's key (not an openai guess) when provider is inferred from the model, with no explicit opts.provider", async () => {
    const secret = "acme-secret-abc123";
    const md = {
      schemaVersion: 1,
      generatedAt: "t",
      hostedTools: [],
      models: [{ type: "text-to-speech", modelName: "custom-acme-model", provider: "acme-tts" }],
    } satisfies ModelDataBlob;
    class AcmeTts extends BaseSpeechClient {
      protected async _speak(): Promise<Result<SpeechResult>> {
        throw new Error(`upstream rejected request signed with ${secret}`);
      }
    }
    registerSpeechProvider("acme-tts", AcmeTts);
    const errorSpy = vi.spyOn(getLogger(), "error").mockImplementation(() => {});
    const r = await speak("hi", {
      model: "custom-acme-model",
      voice: "v",
      modelData: md,
      apiKey: { "acme-tts": secret },
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
});

describe("format handling", () => {
  it("rejects a format outside the model's declared formats", async () => {
    const md = {
      schemaVersion: 1,
      generatedAt: "t",
      hostedTools: [],
      models: [{ type: "text-to-speech", modelName: "custom-1", provider: "openai", formats: ["mp3"] }],
    } satisfies ModelDataBlob;
    const r = await speak("hi", {
      model: "custom-1",
      voice: "alloy",
      provider: "openai",
      apiKey: { openAi: "sk-x" },
      modelData: md,
      format: "wav",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain('Format "wav" is not supported by model "custom-1"');
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("accepts a provider-specific format outside OpenAI's union when the model declares it", async () => {
    const md = {
      schemaVersion: 1,
      generatedAt: "t",
      hostedTools: [],
      models: [{ type: "text-to-speech", modelName: "custom-1", provider: "mulawtts", formats: ["mulaw"] }],
    } satisfies ModelDataBlob;
    let seenFormat: string | undefined;
    class MulawTts extends BaseSpeechClient {
      protected async _speak(): Promise<Result<SpeechResult>> {
        seenFormat = this.config.format;
        return success({ audio: new Uint8Array([1]), mimeType: "audio/basic" });
      }
    }
    registerSpeechProvider("mulawtts", MulawTts);
    const r = await speak("hi", {
      model: "custom-1",
      voice: "v",
      provider: "mulawtts",
      modelData: md,
      format: "mulaw",
    });
    expect(r.success).toBe(true);
    expect(seenFormat).toBe("mulaw");
  });

  it.each(["mulaw", "toString", "constructor", "__proto__"])(
    "the OpenAI runtime guard rejects non-OpenAI format %s",
    async (format) => {
      const r = await speak("hi", {
        model: "unknown-openai-tts",
        voice: "alloy",
        provider: "openai",
        apiKey: { openAi: "sk-x" },
        format,
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error).toContain(`Format "${format}" is not a supported OpenAI speech format`);
      }
      expect(create).not.toHaveBeenCalled();
    },
  );
});

describe("malformed model-data constraints", () => {
  let reached: boolean;
  class CapturedTts extends BaseSpeechClient {
    protected async _speak(): Promise<Result<SpeechResult>> {
      reached = true;
      return okSpeech();
    }
  }
  beforeEach(() => {
    reached = false;
    registerSpeechProvider("badmd", CapturedTts);
  });

  function badModelData(fields: Record<string, unknown>): ModelDataBlob {
    return {
      schemaVersion: 1,
      generatedAt: "t",
      hostedTools: [],
      models: [{ type: "text-to-speech", modelName: "bad-model", provider: "badmd", ...fields }],
    } as unknown as ModelDataBlob;
  }

  const cases: Array<{ label: string; fields: Record<string, unknown>; error: string }> = [
    { label: "negative maxInputChars", fields: { maxInputChars: -1 }, error: "invalid maxInputChars" },
    { label: "non-integer maxInputChars", fields: { maxInputChars: 0.5 }, error: "invalid maxInputChars" },
    { label: "reversed speedRange", fields: { speedRange: { min: 4, max: 0.25 } }, error: "invalid speedRange" },
    { label: "non-finite speedRange", fields: { speedRange: { min: NaN, max: 4 } }, error: "invalid speedRange" },
    { label: "non-object speedRange", fields: { speedRange: "fast" }, error: "invalid speedRange" },
    { label: "non-array formats", fields: { formats: "mp3" }, error: "invalid formats" },
    { label: "non-string formats entries", fields: { formats: [42] }, error: "invalid formats" },
  ];
  for (const { label, fields, error } of cases) {
    it(`rejects ${label} before _speak runs`, async () => {
      const r = await speak("hi", {
        model: "bad-model",
        voice: "v",
        provider: "badmd",
        modelData: badModelData(fields),
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error).toContain(error);
      }
      expect(reached).toBe(false);
    });
  }
});
