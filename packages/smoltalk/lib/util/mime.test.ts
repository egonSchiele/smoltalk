import { describe, it, expect } from "vitest";
import { AUDIO_FORMATS, EXT_TO_MIME, canonicalizeMime, audioFormatForMime } from "./mime.js";

describe("canonicalizeMime", () => {
  it("strips codec parameters and lowercases", () => {
    expect(canonicalizeMime("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(canonicalizeMime("AUDIO/WAV; codecs=1")).toBe("audio/wav");
  });
});

describe("audioFormatForMime", () => {
  it("matches canonical MIME types", () => {
    expect(audioFormatForMime("audio/mpeg")?.extension).toBe("mp3");
    expect(audioFormatForMime("audio/flac")?.extension).toBe("flac");
  });
  it("matches alias MIME types", () => {
    expect(audioFormatForMime("audio/mp3")?.extension).toBe("mp3");
    expect(audioFormatForMime("audio/x-wav")?.extension).toBe("wav");
    expect(audioFormatForMime("video/mp4")?.extension).toBe("mp4");
  });
  it("matches through codec parameters", () => {
    expect(audioFormatForMime("audio/webm;codecs=opus")?.extension).toBe("webm");
  });
  it("returns null for non-audio MIME types", () => {
    expect(audioFormatForMime("image/png")).toBeNull();
  });
});

describe("EXT_TO_MIME", () => {
  it("contains image, pdf, and derived audio entries", () => {
    expect(EXT_TO_MIME[".png"]).toBe("image/png");
    expect(EXT_TO_MIME[".pdf"]).toBe("application/pdf");
    expect(EXT_TO_MIME[".mp3"]).toBe("audio/mpeg");
    expect(EXT_TO_MIME[".mpga"]).toBe("audio/mpeg");
    expect(EXT_TO_MIME[".webm"]).toBe("audio/webm");
  });
  it("derives every audio extension from AUDIO_FORMATS (no drift)", () => {
    for (const format of AUDIO_FORMATS) {
      expect(EXT_TO_MIME[`.${format.extension}`]).toBe(format.mimeType);
    }
  });

  it("recognizes canonical AAC and AIFF entries", () => {
    expect(audioFormatForMime("audio/aac")?.mimeType).toBe("audio/aac");
    expect(audioFormatForMime("audio/aiff")?.mimeType).toBe("audio/aiff");
    expect(audioFormatForMime("audio/x-aiff")?.mimeType).toBe("audio/aiff");
  });
});
