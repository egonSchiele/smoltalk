import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ModelDataBlob } from "../modelData.js";
import { getLogger } from "../util/logger.js";

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

import { OpenAITranscriptionClient } from "./openai.js";
import type { TranscriptionClientConfig } from "./baseTranscriptionClient.js";

const md = {
  schemaVersion: 1,
  generatedAt: "t",
  hostedTools: [],
  models: [{ type: "speech-to-text", modelName: "whisper-1", provider: "openai", perMinuteCost: 0.006 }],
} satisfies ModelDataBlob;

const mdWrongCapability = {
  schemaVersion: 1,
  generatedAt: "t",
  hostedTools: [],
  models: [{ type: "text-to-speech", modelName: "not-an-stt-model", provider: "openai", perCharacterCost: 0.001 }],
} satisfies ModelDataBlob;

beforeEach(() => create.mockReset());

function run(mimeType: string, overrides: Partial<TranscriptionClientConfig> = {}) {
  const client = new OpenAITranscriptionClient({
    model: "whisper-1",
    provider: "openai",
    apiKey: "sk-x",
    modelData: md,
    ...overrides,
  });
  return client.transcribe({ kind: "bytes", data: new Uint8Array([1]), mimeType });
}

describe("OpenAITranscriptionClient", () => {
  it("sends verbose_json + word timestamps, normalizes segments/words, computes duration cost", async () => {
    create.mockResolvedValue({
      text: "hello",
      language: "en",
      duration: 120,
      segments: [{ start: 0, end: 1, text: "hello" }],
      words: [{ start: 0, end: 1, word: "hello" }],
    });
    const r = await run("audio/wav", { timestampGranularity: "word" });
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
    const r = await run("audio/wav", { timestampGranularity: "segment" });
    expect(r.success).toBe(true);
    const call = create.mock.calls[0][0];
    expect(call.timestamp_granularities).toEqual(["segment"]);
  });

  it("omits timestamp_granularities entirely when not requested", async () => {
    create.mockResolvedValue({ text: "hello" });
    await run("audio/wav");
    const call = create.mock.calls[0][0];
    expect(call.timestamp_granularities).toBeUndefined();
  });

  it("forwards language and prompt when provided", async () => {
    create.mockResolvedValue({ text: "bonjour" });
    await run("audio/wav", { language: "fr", prompt: "Technical terms: gRPC, TDD" });
    const call = create.mock.calls[0][0];
    expect(call.language).toBe("fr");
    expect(call.prompt).toBe("Technical terms: gRPC, TDD");
  });

  it("omits language and prompt from the request when not provided", async () => {
    create.mockResolvedValue({ text: "hello" });
    await run("audio/wav");
    const call = create.mock.calls[0][0];
    expect(call.language).toBeUndefined();
    expect(call.prompt).toBeUndefined();
  });

  it("derives a multipart filename and MIME type from the source MIME", async () => {
    create.mockResolvedValue({ text: "hello" });
    await run("audio/mpeg");
    const call = create.mock.calls[0][0];
    expect(call.file.name).toBe("audio.mp3");
    expect(call.file.type).toBe("audio/mpeg");
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
    const r = await run(mime);
    expect(r.success).toBe(true);
    const call = create.mock.calls[0][0];
    expect(call.file.name).toBe(`audio.${ext}`);
  });

  it("rejects an unsupported audio MIME before calling the SDK", async () => {
    const r = await run("audio/basic");
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain('Unsupported audio type "audio/basic"');
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a model that is a known non-STT capability, even with injected modelData", async () => {
    const r = await run("audio/wav", { model: "not-an-stt-model", modelData: mdWrongCapability });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("not a speech-to-text model");
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("converts a rejected SDK promise into a redacted, logged Failure at the transcribe() boundary", async () => {
    create.mockRejectedValueOnce(new Error("sdk exploded near sk-x"));
    const errorSpy = vi.spyOn(getLogger(), "error").mockImplementation(() => {});
    const r = await run("audio/wav");
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).not.toContain("sk-x");
      expect(r.error).toContain("[redacted]");
    }
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});
