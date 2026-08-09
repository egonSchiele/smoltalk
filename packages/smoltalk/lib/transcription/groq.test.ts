import { describe, it, expect, vi, beforeEach } from "vitest";
import { transcribe } from "../transcription.js";

const create = vi.fn();
const ctor = vi.fn();
vi.mock("openai", () => {
  class OpenAI {
    audio = { transcriptions: { create } };
    constructor(opts: unknown) {
      ctor(opts);
    }
  }
  return {
    default: OpenAI,
    toFile: async (data: unknown, name: string, o: { type?: string }) => ({
      data, name, type: o?.type,
    }),
  };
});

describe("GroqTranscriptionClient", () => {
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({ text: "hello groq", duration: 2 });
    ctor.mockReset();
  });

  it("routes to the Groq base URL and returns the transcript", async () => {
    const res = await transcribe(
      { kind: "bytes", data: new Uint8Array([1, 2, 3]), mimeType: "audio/wav" },
      { model: "whisper-large-v3", provider: "groq", apiKey: { groq: "gk-test" } },
    );

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.value.text).toBe("hello groq");
    }
    // The SDK client was constructed pointing at Groq.
    expect(ctor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "gk-test",
        baseURL: "https://api.groq.com/openai/v1",
      }),
    );
    // Inherited OpenAI request shaping still applies.
    expect(create).toHaveBeenCalled();
  });

  it("directs users to the Groq key when none is resolved", async () => {
    delete process.env.GROQ_API_KEY;
    const res = await transcribe(
      { kind: "bytes", data: new Uint8Array([1]), mimeType: "audio/wav" },
      { model: "whisper-large-v3", provider: "groq", apiKey: {} },
    );
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/apiKey\.groq or GROQ_API_KEY/);
  });

  it("infers Groq from the registered model when provider is omitted", async () => {
    const res = await transcribe(
      { kind: "bytes", data: new Uint8Array([1]), mimeType: "audio/wav" },
      { model: "whisper-large-v3", apiKey: { groq: "gk-test" } },
    );
    expect(res.success).toBe(true);
    expect(ctor).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "https://api.groq.com/openai/v1" }),
    );
  });
});
