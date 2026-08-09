import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ModelDataBlob } from "../modelData.js";

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

import { openaiTranscribe } from "./openai.js";

const md = {
  schemaVersion: 1,
  generatedAt: "t",
  hostedTools: [],
  models: [{ type: "speech-to-text", modelName: "whisper-1", provider: "openai", perMinuteCost: 0.006 }],
} satisfies ModelDataBlob;

// A distinct model name (not "whisper-1") so this doesn't deep-merge over the
// baked-in whisper-1 registry entry, which already carries a perMinuteCost.
const mdNoRate = {
  schemaVersion: 1,
  generatedAt: "t",
  hostedTools: [],
  models: [{ type: "speech-to-text", modelName: "whisper-1-no-rate", provider: "openai" }],
} satisfies ModelDataBlob;

const mdWrongCapability = {
  schemaVersion: 1,
  generatedAt: "t",
  hostedTools: [],
  models: [{ type: "text-to-speech", modelName: "whisper-1", provider: "openai", perCharacterCost: 0.001 }],
} satisfies ModelDataBlob;

beforeEach(() => create.mockReset());

describe("openaiTranscribe", () => {
  it("sends verbose_json + word timestamps, normalizes segments/words, computes duration cost", async () => {
    create.mockResolvedValue({
      text: "hello",
      language: "en",
      duration: 120,
      segments: [{ start: 0, end: 1, text: "hello" }],
      words: [{ start: 0, end: 1, word: "hello" }],
    });
    const r = await openaiTranscribe(new Uint8Array([1]), "audio/wav", {
      apiKey: "sk-x",
      opts: { model: "whisper-1", timestampGranularity: "word", modelData: md },
    });
    expect(r.success).toBe(true);
    if (!r.success) {
      throw new Error(r.error);
    }
    const call = create.mock.calls[0][0];
    expect(call.response_format).toBe("verbose_json");
    expect(call.timestamp_granularities).toEqual(["word"]);
    expect(r.value.text).toBe("hello");
    expect(r.value.language).toBe("en");
    expect(r.value.durationSeconds).toBe(120);
    expect(r.value.segments?.[0]).toEqual({ start: 0, end: 1, text: "hello" });
    expect(r.value.words?.[0]).toEqual({ start: 0, end: 1, word: "hello" });
    expect(r.value.cost?.totalCost).toBeCloseTo((120 / 60) * 0.006, 6);
    expect(r.value.cost?.inputCost).toBeCloseTo((120 / 60) * 0.006, 6);
    expect(r.value.cost?.outputCost).toBe(0);
    expect(r.value.cost?.currency).toBe("USD");
  });

  it("requests segment-level timestamps when timestampGranularity is 'segment'", async () => {
    create.mockResolvedValue({ text: "hello", duration: 30, segments: [{ start: 0, end: 1, text: "hello" }] });
    const r = await openaiTranscribe(new Uint8Array([1]), "audio/wav", {
      apiKey: "sk-x",
      opts: { model: "whisper-1", timestampGranularity: "segment", modelData: md },
    });
    expect(r.success).toBe(true);
    const call = create.mock.calls[0][0];
    expect(call.timestamp_granularities).toEqual(["segment"]);
  });

  it("omits timestamp_granularities entirely when not requested", async () => {
    create.mockResolvedValue({ text: "hello" });
    await openaiTranscribe(new Uint8Array([1]), "audio/wav", {
      apiKey: "sk-x",
      opts: { model: "whisper-1", modelData: md },
    });
    const call = create.mock.calls[0][0];
    expect(call.timestamp_granularities).toBeUndefined();
  });

  it("omits cost when duration is absent", async () => {
    create.mockResolvedValue({ text: "hello" });
    const r = await openaiTranscribe(new Uint8Array([1]), "audio/wav", {
      apiKey: "sk-x",
      opts: { model: "whisper-1", modelData: md },
    });
    expect(r.success).toBe(true);
    if (!r.success) {
      throw new Error(r.error);
    }
    expect(r.value.cost).toBeUndefined();
  });

  it("omits cost when the model has no perMinuteCost rate", async () => {
    create.mockResolvedValue({ text: "hello", duration: 60 });
    const r = await openaiTranscribe(new Uint8Array([1]), "audio/wav", {
      apiKey: "sk-x",
      opts: { model: "whisper-1-no-rate", modelData: mdNoRate },
    });
    expect(r.success).toBe(true);
    if (!r.success) {
      throw new Error(r.error);
    }
    expect(r.value.cost).toBeUndefined();
  });

  it("forwards language and prompt when provided", async () => {
    create.mockResolvedValue({ text: "bonjour" });
    await openaiTranscribe(new Uint8Array([1]), "audio/wav", {
      apiKey: "sk-x",
      opts: { model: "whisper-1", language: "fr", prompt: "Technical terms: gRPC, TDD", modelData: md },
    });
    const call = create.mock.calls[0][0];
    expect(call.language).toBe("fr");
    expect(call.prompt).toBe("Technical terms: gRPC, TDD");
  });

  it("omits language and prompt from the request when not provided", async () => {
    create.mockResolvedValue({ text: "hello" });
    await openaiTranscribe(new Uint8Array([1]), "audio/wav", {
      apiKey: "sk-x",
      opts: { model: "whisper-1", modelData: md },
    });
    const call = create.mock.calls[0][0];
    expect(call.language).toBeUndefined();
    expect(call.prompt).toBeUndefined();
  });

  it("derives a multipart filename and MIME type from the source MIME", async () => {
    create.mockResolvedValue({ text: "hello" });
    await openaiTranscribe(new Uint8Array([1]), "audio/mpeg", {
      apiKey: "sk-x",
      opts: { model: "whisper-1", modelData: md },
    });
    const call = create.mock.calls[0][0];
    expect(call.file.name).toBe("audio.mp3");
    expect(call.file.type).toBe("audio/mpeg");
  });

  it("honors an explicit filename override", async () => {
    create.mockResolvedValue({ text: "hello" });
    await openaiTranscribe(new Uint8Array([1]), "audio/wav", {
      apiKey: "sk-x",
      opts: { model: "whisper-1", filename: "my-clip.wav", modelData: md },
    });
    const call = create.mock.calls[0][0];
    expect(call.file.name).toBe("my-clip.wav");
  });

  it.each([
    ["audio/flac", "flac"],
    ["audio/mpeg", "mp3"],
    ["audio/mp3", "mp3"],
    ["audio/mp4", "mp4"],
    ["audio/m4a", "m4a"],
    ["audio/x-m4a", "m4a"],
    ["audio/ogg", "ogg"],
    ["audio/wav", "wav"],
    ["audio/x-wav", "wav"],
    ["audio/webm", "webm"],
  ])("accepts supported transcription MIME %s -> audio.%s", async (mime, ext) => {
    create.mockResolvedValue({ text: "hello" });
    const r = await openaiTranscribe(new Uint8Array([1]), mime, {
      apiKey: "sk-x",
      opts: { model: "whisper-1", modelData: md },
    });
    expect(r.success).toBe(true);
    const call = create.mock.calls[0][0];
    expect(call.file.name).toBe(`audio.${ext}`);
  });

  it("rejects an unsupported audio MIME before calling the SDK", async () => {
    const r = await openaiTranscribe(new Uint8Array([1]), "audio/basic", {
      apiKey: "sk-x",
      opts: { model: "whisper-1", modelData: md },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain('Unsupported audio type "audio/basic"');
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a model that is a known non-STT capability, even with injected modelData", async () => {
    const r = await openaiTranscribe(new Uint8Array([1]), "audio/wav", {
      apiKey: "sk-x",
      opts: { model: "whisper-1", modelData: mdWrongCapability },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("not a speech-to-text model");
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("propagates a rejected SDK promise so the transcribe() boundary can redact/log it", async () => {
    create.mockRejectedValueOnce(new Error("sdk exploded"));
    await expect(
      openaiTranscribe(new Uint8Array([1]), "audio/wav", {
        apiKey: "sk-x",
        opts: { model: "whisper-1", modelData: md },
      }),
    ).rejects.toThrow("sdk exploded");
  });
});
