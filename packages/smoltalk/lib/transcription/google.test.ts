import { describe, it, expect, vi, beforeEach } from "vitest";
import { transcribe } from "../transcription.js";

const generateContent = vi.fn();
vi.mock("@google/genai", () => {
  class GoogleGenAI {
    models = { generateContent };
    constructor(_: unknown) {}
  }
  return { GoogleGenAI };
});

describe("GoogleTranscriptionClient", () => {
  beforeEach(() => {
    generateContent.mockReset();
  });

  it("sends inline audio + instruction and maps text + usage", async () => {
    generateContent.mockResolvedValue({
      text: "the transcript",
      usageMetadata: {
        promptTokenCount: 1100,
        promptTokensDetails: [{ modality: "AUDIO", tokenCount: 1000 }],
        candidatesTokenCount: 20,
        totalTokenCount: 1120,
      },
    });

    const res = await transcribe(
      { kind: "bytes", data: new Uint8Array([1, 2, 3]), mimeType: "audio/wav" },
      { model: "gemini-2.5-flash", apiKey: { google: "gk" }, language: "en" },
    );

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.value.text).toBe("the transcript");
      expect(res.value.usage).toMatchObject({ inputTokens: 100, inputAudioTokens: 1000, outputTokens: 20 });
    }

    const req = generateContent.mock.calls[0][0];
    expect(req.model).toBe("gemini-2.5-flash");
    const parts = req.contents[0].parts;
    expect(parts[0].inlineData.mimeType).toBe("audio/wav");
    expect(typeof parts[0].inlineData.data).toBe("string"); // base64
    expect(parts[1].text).toMatch(/transcribe/i);
    expect(parts[1].text).toMatch(/en/); // language folded in
  });

  it("fails with a clear message when no API key is present", async () => {
    delete process.env.GEMINI_API_KEY;
    const res = await transcribe(
      { kind: "bytes", data: new Uint8Array([1]), mimeType: "audio/wav" },
      { model: "gemini-2.5-flash", provider: "google", apiKey: {} },
    );
    expect(res.success).toBe(false);
  });

  it("maps canonical MP3 MIME to Google's documented wire MIME", async () => {
    generateContent.mockResolvedValue({ text: "ok" });
    await transcribe(
      { kind: "bytes", data: new Uint8Array([1]), mimeType: "audio/mpeg" },
      { model: "gemini-2.5-flash", apiKey: { google: "gk" } },
    );
    expect(generateContent.mock.calls[0][0].contents[0].parts[0].inlineData.mimeType).toBe("audio/mp3");
  });

  it("rejects timestamps without dispatching", async () => {
    const res = await transcribe(
      { kind: "bytes", data: new Uint8Array([1]), mimeType: "audio/wav" },
      { model: "gemini-2.5-flash", apiKey: { google: "gk" }, timestampGranularity: "word" },
    );
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/timestamp/i);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("rejects a total encoded request over the inline limit", async () => {
    const res = await transcribe(
      { kind: "bytes", data: new Uint8Array(14_000_000), mimeType: "audio/wav" },
      {
        model: "gemini-2.5-flash",
        apiKey: { google: "gk" },
        prompt: "x".repeat(1_500_000),
      },
    );
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/20 MB inline request limit/i);
    expect(generateContent).not.toHaveBeenCalled();
  });
});
