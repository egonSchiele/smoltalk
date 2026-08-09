import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ModelDataBlob } from "../modelData.js";

const create = vi.fn();
vi.mock("openai", () => {
  class OpenAI {
    audio = { speech: { create } };
    constructor(_: any) {}
  }
  return { default: OpenAI };
});

import { openaiSpeak } from "./openai.js";

const md = {
  schemaVersion: 1,
  generatedAt: "t",
  hostedTools: [],
  models: [{ type: "text-to-speech", modelName: "tts-1", provider: "openai", perCharacterCost: 0.00001 }],
} satisfies ModelDataBlob;

// A distinct model name (not "tts-1") so this doesn't deep-merge over the
// baked-in tts-1 registry entry, which already carries a perCharacterCost.
const mdNoRate = {
  schemaVersion: 1,
  generatedAt: "t",
  hostedTools: [],
  models: [{ type: "text-to-speech", modelName: "tts-1-no-rate", provider: "openai" }],
} satisfies ModelDataBlob;

beforeEach(() => create.mockReset());
const okResponse = () => ({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });

describe("openaiSpeak", () => {
  it("sends the exact SDK request shape", async () => {
    create.mockResolvedValue(okResponse());
    await openaiSpeak("hello", {
      apiKey: "sk-x",
      opts: { model: "tts-1", voice: "alloy", format: "wav", speed: 1.5, modelData: md },
    });
    expect(create).toHaveBeenCalledWith({
      model: "tts-1",
      voice: "alloy",
      input: "hello",
      response_format: "wav",
      speed: 1.5,
    });
  });

  it("omits speed from the SDK request when not provided", async () => {
    create.mockResolvedValue(okResponse());
    await openaiSpeak("hello", { apiKey: "sk-x", opts: { model: "tts-1", voice: "alloy", modelData: md } });
    const call = create.mock.calls[0][0];
    expect("speed" in call).toBe(false);
  });

  it("defaults to mp3 when no format is given", async () => {
    create.mockResolvedValue(okResponse());
    const r = await openaiSpeak("hello", { apiKey: "sk-x", opts: { model: "tts-1", voice: "alloy", modelData: md } });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.value.mimeType).toBe("audio/mpeg");
    }
    const call = create.mock.calls[0][0];
    expect(call.response_format).toBe("mp3");
  });

  it("returns bytes + exact MIME and Unicode code-point cost", async () => {
    create.mockResolvedValue(okResponse());
    const input = "a😀b";
    expect(input.length).not.toBe([...input].length);
    const r = await openaiSpeak(input, {
      apiKey: "sk-x",
      opts: { model: "tts-1", voice: "alloy", format: "mp3", modelData: md },
    });
    expect(r.success).toBe(true);
    if (!r.success) {
      throw new Error(r.error);
    }
    expect(r.value.mimeType).toBe("audio/mpeg");
    expect(r.value.audio.length).toBe(3);
    expect(r.value.cost?.totalCost).toBeCloseTo(3 * 0.00001, 6);
    expect(r.value.cost?.inputCost).toBeCloseTo(3 * 0.00001, 6);
    expect(r.value.cost?.outputCost).toBe(0);
    expect(r.value.cost?.currency).toBe("USD");
  });

  it.each([
    ["mp3", "audio/mpeg"],
    ["opus", "audio/ogg"],
    ["aac", "audio/aac"],
    ["flac", "audio/flac"],
    ["wav", "audio/wav"],
    ["pcm", "application/octet-stream"],
  ])("maps format %s to MIME %s", async (format, mime) => {
    create.mockResolvedValue(okResponse());
    const r = await openaiSpeak("hi", {
      apiKey: "sk-x",
      opts: { model: "tts-1", voice: "alloy", format: format as any, modelData: md },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.value.mimeType).toBe(mime);
    }
  });

  it("attaches PCM metadata only for pcm format", async () => {
    create.mockResolvedValue(okResponse());
    const r = await openaiSpeak("hi", { apiKey: "sk-x", opts: { model: "tts-1", voice: "alloy", format: "pcm", modelData: md } });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.value.pcm).toEqual({ sampleRateHz: 24000, sampleFormat: "s16le", channels: 1 });
    }
  });

  it("omits PCM metadata for non-pcm formats", async () => {
    create.mockResolvedValue(okResponse());
    const r = await openaiSpeak("hi", { apiKey: "sk-x", opts: { model: "tts-1", voice: "alloy", format: "mp3", modelData: md } });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.value.pcm).toBeUndefined();
    }
  });

  it("passes through the minimum speed (0.25)", async () => {
    create.mockResolvedValue(okResponse());
    await openaiSpeak("hi", { apiKey: "sk-x", opts: { model: "tts-1", voice: "alloy", speed: 0.25, modelData: md } });
    expect(create.mock.calls[0][0].speed).toBe(0.25);
  });

  it("passes through the maximum speed (4.0)", async () => {
    create.mockResolvedValue(okResponse());
    await openaiSpeak("hi", { apiKey: "sk-x", opts: { model: "tts-1", voice: "alloy", speed: 4, modelData: md } });
    expect(create.mock.calls[0][0].speed).toBe(4);
  });

  it("rejects an unknown format before calling the SDK", async () => {
    const r = await openaiSpeak("hi", {
      apiKey: "sk-x",
      opts: { model: "tts-1", voice: "alloy", format: "wma" as any, modelData: md },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain('Unknown speech format "wma"');
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("omits cost when the model has no perCharacterCost rate", async () => {
    create.mockResolvedValue(okResponse());
    const r = await openaiSpeak("hello", {
      apiKey: "sk-x",
      opts: { model: "tts-1-no-rate", voice: "alloy", modelData: mdNoRate },
    });
    expect(r.success).toBe(true);
    if (!r.success) {
      throw new Error(r.error);
    }
    expect(r.value.cost).toBeUndefined();
  });

  it("omits cost when the model is unknown to the registry", async () => {
    create.mockResolvedValue(okResponse());
    const r = await openaiSpeak("hello", { apiKey: "sk-x", opts: { model: "totally-unknown-tts", voice: "alloy" } });
    expect(r.success).toBe(true);
    if (!r.success) {
      throw new Error(r.error);
    }
    expect(r.value.cost).toBeUndefined();
  });

  it("propagates a rejected SDK promise so the speak() boundary can redact/log it", async () => {
    create.mockRejectedValueOnce(new Error("sdk exploded"));
    await expect(
      openaiSpeak("hi", { apiKey: "sk-x", opts: { model: "tts-1", voice: "alloy", modelData: md } }),
    ).rejects.toThrow("sdk exploded");
  });
});
