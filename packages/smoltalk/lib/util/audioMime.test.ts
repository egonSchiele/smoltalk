import { describe, it, expect } from "vitest";
import {
  transcriptionAudioType,
  chatAudioFormat,
  SPEECH_FORMAT_TO_MIME,
  type SpeakFormat,
} from "./audioMime.js";

describe("audioMime", () => {
  it("derives a filename with a real extension", () => {
    expect(transcriptionAudioType("audio/mpeg")).toEqual({ extension: "mp3", filename: "audio.mp3" });
    expect(transcriptionAudioType("audio/wav")).toEqual({ extension: "wav", filename: "audio.wav" });
  });

  it("recognizes supported transcription MIME types", () => {
    expect(transcriptionAudioType("audio/ogg")).toEqual({ extension: "ogg", filename: "audio.ogg" });
    expect(transcriptionAudioType("audio/basic")).toBeNull();
  });

  it("maps only mp3/wav for chat input_audio", () => {
    expect(chatAudioFormat("audio/mpeg")).toBe("mp3");
    expect(chatAudioFormat("audio/wav")).toBe("wav");
    expect(chatAudioFormat("audio/ogg")).toBeNull();
  });

  it("maps pcm output to application/octet-stream", () => {
    expect(SPEECH_FORMAT_TO_MIME.pcm).toBe("application/octet-stream");
    expect(SPEECH_FORMAT_TO_MIME.mp3).toBe("audio/mpeg");
  });

  describe("transcriptionAudioType: every supported alias", () => {
    const cases: Array<{ mime: string; extension: string; filename: string }> = [
      { mime: "audio/flac", extension: "flac", filename: "audio.flac" },
      { mime: "audio/mpeg", extension: "mp3", filename: "audio.mp3" },
      { mime: "audio/mp3", extension: "mp3", filename: "audio.mp3" },
      { mime: "audio/mp4", extension: "mp4", filename: "audio.mp4" },
      { mime: "audio/m4a", extension: "m4a", filename: "audio.m4a" },
      { mime: "audio/x-m4a", extension: "m4a", filename: "audio.m4a" },
      { mime: "audio/ogg", extension: "ogg", filename: "audio.ogg" },
      { mime: "audio/wav", extension: "wav", filename: "audio.wav" },
      { mime: "audio/x-wav", extension: "wav", filename: "audio.wav" },
      { mime: "audio/webm", extension: "webm", filename: "audio.webm" },
    ];

    for (const testCase of cases) {
      it(`maps ${testCase.mime} deterministically`, () => {
        expect(transcriptionAudioType(testCase.mime)).toEqual({
          extension: testCase.extension,
          filename: testCase.filename,
        });
      });
    }

    it("returns null for an unsupported transcription MIME type", () => {
      expect(transcriptionAudioType("audio/basic")).toBeNull();
      expect(transcriptionAudioType("application/octet-stream")).toBeNull();
      expect(transcriptionAudioType("")).toBeNull();
    });
  });

  describe("SPEECH_FORMAT_TO_MIME: every speech output mapping", () => {
    const cases: Array<{ format: SpeakFormat; mime: string }> = [
      { format: "mp3", mime: "audio/mpeg" },
      { format: "opus", mime: "audio/ogg" },
      { format: "aac", mime: "audio/aac" },
      { format: "flac", mime: "audio/flac" },
      { format: "wav", mime: "audio/wav" },
      { format: "pcm", mime: "application/octet-stream" },
    ];

    for (const testCase of cases) {
      it(`maps ${testCase.format} to ${testCase.mime}`, () => {
        expect(SPEECH_FORMAT_TO_MIME[testCase.format]).toBe(testCase.mime);
      });
    }
  });

  describe("chatAudioFormat: all aliases plus OGG rejection", () => {
    it("accepts every mp3 alias", () => {
      expect(chatAudioFormat("audio/mpeg")).toBe("mp3");
      expect(chatAudioFormat("audio/mp3")).toBe("mp3");
    });

    it("accepts every wav alias", () => {
      expect(chatAudioFormat("audio/wav")).toBe("wav");
      expect(chatAudioFormat("audio/x-wav")).toBe("wav");
    });

    it("rejects OGG and other non mp3/wav types", () => {
      expect(chatAudioFormat("audio/ogg")).toBeNull();
      expect(chatAudioFormat("audio/flac")).toBeNull();
      expect(chatAudioFormat("audio/webm")).toBeNull();
      expect(chatAudioFormat("audio/mp4")).toBeNull();
    });
  });
});
