import { describe, it, expect } from "vitest";
import {
  transcriptionAudioType,
  chatAudioFormat,
  SPEECH_FORMAT_TO_MIME,
  googleAudioWireMime,
  pcmToWav,
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

  describe("MIME canonicalization (parameters + case)", () => {
    it("strips codec parameters for transcriptionAudioType", () => {
      expect(transcriptionAudioType("audio/webm;codecs=opus")).toEqual({
        extension: "webm",
        filename: "audio.webm",
      });
      expect(transcriptionAudioType("audio/wav; codecs=1")).toEqual({
        extension: "wav",
        filename: "audio.wav",
      });
    });

    it("accepts video/mp4 as an MP4 audio-container alias for transcription", () => {
      expect(transcriptionAudioType("video/mp4")).toEqual({ extension: "mp4", filename: "audio.mp4" });
    });

    it("is case-insensitive for transcriptionAudioType", () => {
      expect(transcriptionAudioType("AUDIO/MPEG")).toEqual({ extension: "mp3", filename: "audio.mp3" });
    });

    it("strips codec parameters for chatAudioFormat", () => {
      expect(chatAudioFormat("audio/wav; codecs=1")).toBe("wav");
      expect(chatAudioFormat("audio/mpeg;codecs=mp3")).toBe("mp3");
    });
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

describe("pcmToWav", () => {
  it("prepends a valid 44-byte WAV header for 24kHz mono s16le", () => {
    const pcm = new Uint8Array([1, 2, 3, 4]);
    const wav = pcmToWav(pcm, { sampleRateHz: 24000, channels: 1, bitsPerSample: 16 });

    expect(wav.length).toBe(44 + pcm.length);
    const ascii = (a: Uint8Array, i: number, n: number) =>
      String.fromCharCode(...a.slice(i, i + n));
    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(ascii(wav, 8, 4)).toBe("WAVE");
    expect(ascii(wav, 12, 4)).toBe("fmt ");
    expect(ascii(wav, 36, 4)).toBe("data");

    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getUint32(4, true)).toBe(36 + pcm.length); // chunk size
    expect(view.getUint16(22, true)).toBe(1); // channels
    expect(view.getUint32(24, true)).toBe(24000); // sample rate
    expect(view.getUint32(28, true)).toBe(24000 * 1 * 2); // byte rate
    expect(view.getUint16(34, true)).toBe(16); // bits/sample
    expect(view.getUint32(40, true)).toBe(pcm.length); // data size
    expect(Array.from(wav.slice(44))).toEqual([1, 2, 3, 4]);
  });
});

describe("googleAudioWireMime", () => {
  it("maps MP3 aliases and the canonical MIME to Google's wire value", () => {
    expect(googleAudioWireMime("audio/mpeg")).toBe("audio/mp3");
    expect(googleAudioWireMime("audio/mp3")).toBe("audio/mp3");
  });

  it("normalizes supported non-MP3 audio MIME values", () => {
    expect(googleAudioWireMime("AUDIO/AAC")).toBe("audio/aac");
    expect(googleAudioWireMime("audio/aiff")).toBe("audio/aiff");
  });
});
