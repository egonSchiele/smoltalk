import { describe, it, expect, vi, beforeEach } from "vitest";
import { speak } from "../speech.js";

const generateContent = vi.fn();
vi.mock("@google/genai", () => {
  class GoogleGenAI {
    models = { generateContent };
    constructor(_: unknown) {}
  }
  return { GoogleGenAI };
});

const pcmBase64 = Buffer.from(new Uint8Array([1, 2, 3, 4])).toString("base64");

function mockAudioResponse() {
  generateContent.mockResolvedValue({
    candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;rate=24000", data: pcmBase64 } }] } }],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 200,
      candidatesTokensDetails: [{ modality: "AUDIO", tokenCount: 200 }],
      totalTokenCount: 210,
    },
  });
}

describe("GoogleSpeechClient", () => {
  beforeEach(() => generateContent.mockReset());

  it("returns raw PCM by default with pcm metadata", async () => {
    mockAudioResponse();
    const res = await speak("hi", {
      model: "gemini-2.5-flash-preview-tts", voice: "Kore",
      apiKey: { google: "gk" },
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.value.mimeType).toBe("application/octet-stream");
      expect(Array.from(res.value.audio)).toEqual([1, 2, 3, 4]);
      expect(res.value.pcm).toEqual({ sampleRateHz: 24000, sampleFormat: "s16le", channels: 1 });
      expect(res.value.usage).toMatchObject({ inputTokens: 10, outputAudioTokens: 200 });
    }
    const req = generateContent.mock.calls[0][0];
    expect(req.config.responseModalities).toEqual(["AUDIO"]);
    expect(req.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Kore");
  });

  it("wraps PCM in a WAV header when format is 'wav'", async () => {
    mockAudioResponse();
    const res = await speak("hi", {
      model: "gemini-2.5-flash-preview-tts", voice: "Kore", format: "wav",
      provider: "google", apiKey: { google: "gk" },
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.value.mimeType).toBe("audio/wav");
      expect(res.value.audio.length).toBe(44 + 4);
      expect(String.fromCharCode(...res.value.audio.slice(0, 4))).toBe("RIFF");
    }
  });

  it("rejects unsupported formats and the speed option", async () => {
    const bad = await speak("hi", {
      model: "gemini-2.5-flash-preview-tts", voice: "Kore", format: "mp3",
      provider: "google", apiKey: { google: "gk" },
    });
    expect(bad.success).toBe(false);

    const speedy = await speak("hi", {
      model: "gemini-2.5-flash-preview-tts", voice: "Kore", speed: 1.5,
      provider: "google", apiKey: { google: "gk" },
    });
    expect(speedy.success).toBe(false);
    if (!speedy.success) expect(speedy.error).toMatch(/speed/i);
  });

  it("does not invent an 8,000-character limit for a 32k-token context", async () => {
    mockAudioResponse();
    const res = await speak("a".repeat(8_001), {
      model: "gemini-2.5-flash-preview-tts",
      voice: "Kore",
      apiKey: { google: "gk" },
    });
    expect(res.success).toBe(true);
    expect(generateContent).toHaveBeenCalledOnce();
  });
});
