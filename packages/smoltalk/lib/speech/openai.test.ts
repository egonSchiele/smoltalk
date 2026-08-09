import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ModelDataBlob } from "../modelData.js";
import { getLogger } from "../util/logger.js";

const create = vi.fn();
vi.mock("openai", () => {
  class OpenAI {
    audio = { speech: { create } };
    constructor(_: any) {}
  }
  return { default: OpenAI };
});

import { OpenAISpeechClient } from "./openai.js";
import type { SpeechClientConfig } from "./baseSpeechClient.js";

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

// A distinct model name with an explicit zero rate: cost must still be
// reported (not suppressed) when perCharacterCost is exactly 0.
const mdZeroRate = {
  schemaVersion: 1,
  generatedAt: "t",
  hostedTools: [],
  models: [{ type: "text-to-speech", modelName: "tts-1-zero-rate", provider: "openai", perCharacterCost: 0 }],
} satisfies ModelDataBlob;

beforeEach(() => create.mockReset());
const okResponse = () => ({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });

function run(text: string, overrides: Partial<SpeechClientConfig> = {}) {
  const client = new OpenAISpeechClient({
    model: "tts-1",
    provider: "openai",
    apiKey: "sk-x",
    voice: "alloy",
    modelData: md,
    ...overrides,
  });
  return client.speak(text);
}

describe("OpenAISpeechClient", () => {
  it("sends the exact SDK request shape", async () => {
    create.mockResolvedValue(okResponse());
    await run("hello", { format: "wav", speed: 1.5 });
    expect(create).toHaveBeenCalledWith(
      {
        model: "tts-1",
        voice: "alloy",
        input: "hello",
        response_format: "wav",
        speed: 1.5,
      },
      { signal: undefined },
    );
  });

  it("omits speed from the SDK request when not provided", async () => {
    create.mockResolvedValue(okResponse());
    await run("hello");
    const call = create.mock.calls[0][0];
    expect("speed" in call).toBe(false);
  });

  it("defaults to mp3 when no format is given", async () => {
    create.mockResolvedValue(okResponse());
    const r = await run("hello");
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
    const r = await run(input, { format: "mp3" });
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
    const r = await run("hi", { format });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.value.mimeType).toBe(mime);
    }
  });

  it("attaches PCM metadata only for pcm format", async () => {
    create.mockResolvedValue(okResponse());
    const r = await run("hi", { format: "pcm" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.value.pcm).toEqual({ sampleRateHz: 24000, sampleFormat: "s16le", channels: 1 });
    }
  });

  it("omits PCM metadata for non-pcm formats", async () => {
    create.mockResolvedValue(okResponse());
    const r = await run("hi", { format: "mp3" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.value.pcm).toBeUndefined();
    }
  });

  it("passes through the minimum speed (0.25)", async () => {
    create.mockResolvedValue(okResponse());
    await run("hi", { speed: 0.25 });
    expect(create.mock.calls[0][0].speed).toBe(0.25);
  });

  it("passes through the maximum speed (4.0)", async () => {
    create.mockResolvedValue(okResponse());
    await run("hi", { speed: 4 });
    expect(create.mock.calls[0][0].speed).toBe(4);
  });

  it("rejects a format outside the model's declared list before calling the SDK", async () => {
    const r = await run("hi", { format: "wma" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain('Format "wma" is not supported by model "tts-1"');
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a non-OpenAI format via the runtime guard when the model declares no format list", async () => {
    const r = await run("hi", { model: "unknown-openai-tts", format: "wma" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain('Format "wma" is not a supported OpenAI speech format');
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("omits cost when the model has no perCharacterCost rate", async () => {
    create.mockResolvedValue(okResponse());
    const r = await run("hello", { model: "tts-1-no-rate", modelData: mdNoRate });
    expect(r.success).toBe(true);
    if (!r.success) {
      throw new Error(r.error);
    }
    expect(r.value.cost).toBeUndefined();
  });

  it("reports a present zero cost when the model's perCharacterCost is exactly 0", async () => {
    create.mockResolvedValue(okResponse());
    const r = await run("hello", { model: "tts-1-zero-rate", modelData: mdZeroRate });
    expect(r.success).toBe(true);
    if (!r.success) {
      throw new Error(r.error);
    }
    expect(r.value.cost).toEqual({ inputCost: 0, outputCost: 0, totalCost: 0, currency: "USD" });
  });

  it("omits cost when the model is unknown to the registry", async () => {
    create.mockResolvedValue(okResponse());
    const r = await run("hello", { model: "totally-unknown-tts", modelData: undefined });
    expect(r.success).toBe(true);
    if (!r.success) {
      throw new Error(r.error);
    }
    expect(r.value.cost).toBeUndefined();
  });

  it("converts a rejected SDK promise into a redacted, logged Failure at the speak() boundary", async () => {
    create.mockRejectedValueOnce(new Error("sdk exploded near sk-x"));
    const errorSpy = vi.spyOn(getLogger(), "error").mockImplementation(() => {});
    const r = await run("hi");
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).not.toContain("sk-x");
      expect(r.error).toContain("[redacted]");
    }
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});
