import { describe, it, expect, vi, beforeEach } from "vitest";
import { transcribe } from "./transcription.js";
import { speak } from "./speech.js";
import { getLogger } from "./util/logger.js";

const oaiTranscribe = vi.fn();
const oaiSpeech = vi.fn();
vi.mock("openai", () => {
  class OpenAI {
    audio = {
      transcriptions: { create: oaiTranscribe },
      speech: { create: oaiSpeech },
    };
    constructor(_: unknown) {}
  }
  return {
    default: OpenAI,
    toFile: async (data: unknown, name: string, o: { type?: string }) => ({ data, name, type: o?.type }),
  };
});

const genContent = vi.fn();
vi.mock("@google/genai", () => {
  class GoogleGenAI {
    models = { generateContent: genContent };
    constructor(_: unknown) {}
  }
  return { GoogleGenAI };
});

const src = { kind: "bytes" as const, data: new Uint8Array([1, 2, 3]), mimeType: "audio/wav" };
const pcmB64 = Buffer.from(new Uint8Array([1, 2, 3, 4])).toString("base64");

beforeEach(() => {
  oaiTranscribe.mockReset();
  oaiTranscribe.mockResolvedValue({ text: "ok", duration: 1 });
  oaiSpeech.mockReset();
  oaiSpeech.mockResolvedValue({ arrayBuffer: async () => new Uint8Array([9]).buffer });
  genContent.mockReset();
});

describe("audio cancellation — signal forwarding", () => {
  it("forwards abortSignal to the OpenAI transcription SDK call", async () => {
    const c = new AbortController();
    await transcribe(src, { model: "whisper-1", provider: "openai", apiKey: { openAi: "sk" }, abortSignal: c.signal });
    expect(oaiTranscribe.mock.calls[0][1]).toEqual({ signal: c.signal });
  });

  it("forwards abortSignal to the OpenAI speech SDK call", async () => {
    const c = new AbortController();
    await speak("hi", { model: "tts-1", voice: "alloy", provider: "openai", apiKey: { openAi: "sk" }, abortSignal: c.signal });
    expect(oaiSpeech.mock.calls[0][1]).toEqual({ signal: c.signal });
  });

  it("forwards abortSignal into the Gemini transcription config", async () => {
    genContent.mockResolvedValue({ text: "ok" });
    const c = new AbortController();
    await transcribe(src, { model: "gemini-2.5-flash", provider: "google", apiKey: { google: "gk" }, abortSignal: c.signal });
    expect(genContent.mock.calls[0][0].config.abortSignal).toBe(c.signal);
  });

  it("forwards abortSignal into the Gemini speech config", async () => {
    genContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ inlineData: { data: pcmB64 } }] } }],
    });
    const c = new AbortController();
    await speak("hi", {
      model: "gemini-2.5-flash-preview-tts", voice: "Kore", provider: "google",
      apiKey: { google: "gk" }, abortSignal: c.signal,
    });
    expect(genContent.mock.calls[0][0].config.abortSignal).toBe(c.signal);
  });
});

describe("audio cancellation — abort outcome", () => {
  it("short-circuits an already-aborted signal without calling the SDK", async () => {
    const c = new AbortController();
    c.abort();
    const r = await transcribe(src, { model: "whisper-1", provider: "openai", apiKey: { openAi: "sk" }, abortSignal: c.signal });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("Request was aborted");
    expect(oaiTranscribe).not.toHaveBeenCalled();
  });

  it("maps a mid-flight abort to a distinguishable 'Request was aborted' failure", async () => {
    const c = new AbortController();
    oaiSpeech.mockImplementation(async () => {
      c.abort();
      throw new Error("The operation was aborted");
    });
    const r = await speak("hi", { model: "tts-1", voice: "alloy", provider: "openai", apiKey: { openAi: "sk" }, abortSignal: c.signal });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("Request was aborted");
  });

  it("leaves a non-abort provider failure as a redacted failure (regression guard)", async () => {
    const errorSpy = vi.spyOn(getLogger(), "error").mockImplementation(() => {});
    oaiTranscribe.mockRejectedValue(new Error("upstream boom near sk-secret"));
    const c = new AbortController(); // never aborted
    const r = await transcribe(src, { model: "whisper-1", provider: "openai", apiKey: { openAi: "sk-secret" }, abortSignal: c.signal });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).not.toBe("Request was aborted");
      expect(r.error).not.toContain("sk-secret");
      expect(r.error).toContain("[redacted]");
    }
    errorSpy.mockRestore();
  });
});
