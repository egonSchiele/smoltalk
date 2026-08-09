import { describe, it, expect } from "vitest";
import { OpenAIChatRenderer } from "./OpenAIChatRenderer.js";
import { OpenAIResponsesRenderer } from "./OpenAIResponsesRenderer.js";
import { GoogleRenderer } from "./GoogleRenderer.js";
import { AnthropicRenderer } from "./AnthropicRenderer.js";
import { JSONRenderer } from "./JSONRenderer.js";
import { renderParts } from "./PartRenderer.js";
import type { AudioPart } from "../contentParts.js";

describe("OpenAIChatRenderer.audio", () => {
  it("emits input_audio with base64 + derived format", () => {
    const out: any = new OpenAIChatRenderer().audio({
      type: "audio",
      source: { kind: "base64", base64: "AAAA", mimeType: "audio/wav" },
    });
    expect(out.type).toBe("input_audio");
    expect(out.input_audio).toEqual({ data: "AAAA", format: "wav" });
  });

  it("emits the exact MP3 wire format", () => {
    const out: any = new OpenAIChatRenderer().audio({
      type: "audio",
      source: { kind: "base64", base64: "SGVsbG8=", mimeType: "audio/mpeg" },
    });
    expect(out).toEqual({
      type: "input_audio",
      input_audio: { data: "SGVsbG8=", format: "mp3" },
    });
  });

  it("emits the exact WAV wire format", () => {
    const out: any = new OpenAIChatRenderer().audio({
      type: "audio",
      source: { kind: "base64", base64: "SGVsbG8=", mimeType: "audio/wav" },
    });
    expect(out).toEqual({
      type: "input_audio",
      input_audio: { data: "SGVsbG8=", format: "wav" },
    });
  });

  it("throws (defensive) for a non-mp3/wav mime", () => {
    const part: AudioPart = { type: "audio", source: { kind: "base64", base64: "AAAA", mimeType: "audio/ogg" } };
    expect(() => new OpenAIChatRenderer().audio(part)).toThrow();
  });

  it("throws (defensive) for an unresolved (non-base64) source", () => {
    const part: AudioPart = { type: "audio", source: { kind: "path", path: "/tmp/clip.wav" } };
    expect(() => new OpenAIChatRenderer().audio(part)).toThrow(
      "internal: audio source must be prepared as base64 before rendering",
    );
  });
});

describe("renderParts dispatch", () => {
  it("dispatches an audio part to renderer.audio, not renderer.file", () => {
    const part: AudioPart = { type: "audio", source: { kind: "base64", base64: "AAAA", mimeType: "audio/wav" } };
    const out = renderParts([part], new JSONRenderer());
    expect(out[0]).toEqual({ type: "audio", source: { kind: "base64", base64: "AAAA", mimeType: "audio/wav" }, filename: undefined });
  });
});

describe("JSONRenderer.audio", () => {
  it("base64-encodes raw bytes exactly", () => {
    const part: AudioPart = {
      type: "audio",
      source: { kind: "bytes", data: new Uint8Array([1, 2, 3]), mimeType: "audio/wav" },
    };
    const out = new JSONRenderer().audio(part);
    expect(out).toEqual({
      type: "audio",
      source: { kind: "base64", base64: "AQID", mimeType: "audio/wav" },
      filename: undefined,
    });
  });

  it("passes through an already-base64 source unchanged", () => {
    const part: AudioPart = {
      type: "audio",
      source: { kind: "base64", base64: "AQID", mimeType: "audio/wav" },
      filename: "clip.wav",
    };
    const out = new JSONRenderer().audio(part);
    expect(out).toEqual({
      type: "audio",
      source: { kind: "base64", base64: "AQID", mimeType: "audio/wav" },
      filename: "clip.wav",
    });
  });
});

describe("defensive/unsupported renderers", () => {
  const part: AudioPart = { type: "audio", source: { kind: "base64", base64: "AAAA", mimeType: "audio/wav" } };

  it("OpenAIResponsesRenderer.audio throws", () => {
    expect(() => new OpenAIResponsesRenderer().audio(part)).toThrow(
      "Audio input is not supported for this provider in v1.",
    );
  });

  it("GoogleRenderer.audio throws", () => {
    expect(() => new GoogleRenderer().audio(part)).toThrow(
      "Audio input is not supported for this provider in v1.",
    );
  });

  it("AnthropicRenderer.audio throws", () => {
    expect(() => new AnthropicRenderer().audio(part)).toThrow(
      "Audio input is not supported for this provider in v1.",
    );
  });
});
