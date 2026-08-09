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

import { speak, registerSpeechProvider, _resetForTests } from "./speech.js";

beforeEach(() => {
  _resetForTests();
  create.mockReset();
});

const okResponse = () => ({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });

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
      expect(r.error).toContain("speed must be a finite number");
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects text over 4096 code points on the OpenAI branch", async () => {
    const input = "😀".repeat(4096) + "a";
    expect(input.length).not.toBe([...input].length);
    const r = await speak(input, { model: "tts-1", voice: "alloy", provider: "openai", apiKey: { openAi: "sk-x" } });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("4096-character OpenAI TTS limit");
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

  it("rejects an OpenAI model outside the allowlist", async () => {
    const r = await speak("hi", { model: "gpt-4o-mini-tts", voice: "alloy", provider: "openai", apiKey: { openAi: "sk-x" } });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("not a supported OpenAI speech model");
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
    const r = await speak("hi", { model: "totally-unknown-model", voice: "alloy" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("not recognized");
    }
  });

  it("rejects an unregistered custom provider", async () => {
    const r = await speak("hi", { model: "custom-1", voice: "v", provider: "someprovider" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("has no speech API");
    }
  });

  it("dispatches unknown model to a registered custom provider", async () => {
    registerSpeechProvider("mytts", {
      async speak() {
        return { success: true, value: { audio: new Uint8Array([1]), mimeType: "audio/mpeg" } };
      },
    });
    const r = await speak("hi", { model: "c1", voice: "v", provider: "mytts" });
    expect(r.success).toBe(true);
  });

  it("passes exact text, resolved key, and options to a custom provider", async () => {
    let seenText: string | undefined;
    let seenCtx: unknown;
    registerSpeechProvider("mytts", {
      async speak(text, ctx) {
        seenText = text;
        seenCtx = ctx;
        return { success: true, value: { audio: new Uint8Array([1]), mimeType: "audio/mpeg" } };
      },
    });
    const r = await speak("hello world", {
      model: "custom-1",
      voice: "v",
      provider: "mytts",
      apiKey: { openAi: "sk-should-not-appear", ollama: "ollama-key" },
    });
    expect(r.success).toBe(true);
    expect(seenText).toBe("hello world");
    expect(seenCtx).toEqual({
      apiKey: "",
      opts: { model: "custom-1", voice: "v", provider: "mytts" },
    });
  });

  it("passes a custom provider's apiKey, keyed by its exact registered name, through to ctx.apiKey", async () => {
    let seenCtx: unknown;
    registerSpeechProvider("acme", {
      async speak(_text, ctx) {
        seenCtx = ctx;
        return { success: true, value: { audio: new Uint8Array([1]), mimeType: "audio/mpeg" } };
      },
    });
    const r = await speak("hi", {
      model: "custom-1",
      voice: "v",
      provider: "acme",
      apiKey: { acme: "secret-123" },
    });
    expect(r.success).toBe(true);
    expect((seenCtx as { apiKey: string }).apiKey).toBe("secret-123");
  });

  it("does not subject a custom provider to OpenAI's speed/char limits", async () => {
    registerSpeechProvider("mytts", {
      async speak() {
        return { success: true, value: { audio: new Uint8Array([1]), mimeType: "audio/mpeg" } };
      },
    });
    const input = "😀".repeat(4096) + "a";
    const r = await speak(input, { model: "custom-1", voice: "v", provider: "mytts", speed: 99 });
    expect(r.success).toBe(true);
  });

  it("does not let a registered provider override the built-in openai handling", async () => {
    registerSpeechProvider("openai", {
      async speak() {
        return { success: true, value: { audio: new Uint8Array([1]), mimeType: "audio/mpeg" } };
      },
    });
    const r = await speak("hi", { model: "gpt-4o-mini-tts", voice: "alloy", provider: "openai", apiKey: { openAi: "sk-x" } });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("not a supported OpenAI speech model");
    }
  });

  it("does not let injected modelData bypass the OpenAI allowlist", async () => {
    const md = {
      schemaVersion: 1,
      generatedAt: "t",
      hostedTools: [],
      models: [{ type: "text-to-speech", modelName: "custom-1", provider: "openai", perCharacterCost: 0.00001 }],
    } satisfies ModelDataBlob;
    const r = await speak("hi", {
      model: "custom-1",
      voice: "alloy",
      provider: "openai",
      apiKey: { openAi: "sk-x" },
      modelData: md,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("not a supported OpenAI speech model");
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("converts a synchronous throw and a rejected promise into Failure", async () => {
    registerSpeechProvider("boom", {
      speak() {
        throw new Error("x");
      },
    });
    registerSpeechProvider("rej", {
      async speak() {
        return Promise.reject(new Error("y"));
      },
    });
    expect((await speak("hi", { model: "c", voice: "v", provider: "boom" })).success).toBe(false);
    expect((await speak("hi", { model: "c", voice: "v", provider: "rej" })).success).toBe(false);
  });

  it("converts a synchronous provider throw into a Failure and logs one redacted error", async () => {
    registerSpeechProvider("boom", {
      speak() {
        throw new Error("kaboom");
      },
    });
    const errorSpy = vi.spyOn(getLogger(), "error").mockImplementation(() => {});
    const r = await speak("hi", { model: "x", voice: "v", provider: "boom" });
    expect(r.success).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("converts a rejected provider promise into a Failure and logs one redacted error", async () => {
    registerSpeechProvider("rej", {
      async speak() {
        return Promise.reject(new Error("nope"));
      },
    });
    const errorSpy = vi.spyOn(getLogger(), "error").mockImplementation(() => {});
    const r = await speak("hi", { model: "x", voice: "v", provider: "rej" });
    expect(r.success).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
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
    const secret = "google-secret-abc123";
    const md = {
      schemaVersion: 1,
      generatedAt: "t",
      hostedTools: [],
      models: [{ type: "text-to-speech", modelName: "custom-google-model", provider: "google" }],
    } satisfies ModelDataBlob;
    registerSpeechProvider("google", {
      async speak() {
        throw new Error(`upstream rejected request signed with ${secret}`);
      },
    });
    const errorSpy = vi.spyOn(getLogger(), "error").mockImplementation(() => {});
    const r = await speak("hi", {
      model: "custom-google-model",
      voice: "v",
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
});
