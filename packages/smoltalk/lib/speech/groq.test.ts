import { describe, it, expect, vi, beforeEach } from "vitest";
import { speak } from "../speech.js";

const create = vi.fn();
const ctor = vi.fn();
vi.mock("openai", () => {
  class OpenAI {
    audio = { speech: { create } };
    constructor(opts: unknown) {
      ctor(opts);
    }
  }
  return { default: OpenAI };
});

describe("GroqSpeechClient", () => {
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({
      arrayBuffer: async () => new Uint8Array([9, 9, 9]).buffer,
    });
    ctor.mockReset();
  });

  it("infers Groq and uses wav when format is omitted", async () => {
    const res = await speak("hello", {
      model: "canopylabs/orpheus-v1-english",
      voice: "troy",
      apiKey: { groq: "gk-test" },
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(Array.from(res.value.audio)).toEqual([9, 9, 9]);
      expect(res.value.mimeType).toBe("audio/wav");
    }
    expect(ctor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "gk-test",
        baseURL: "https://api.groq.com/openai/v1",
      }),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "canopylabs/orpheus-v1-english",
        response_format: "wav",
      }),
    );
  });

  it("rejects an explicit non-wav format before dispatch", async () => {
    const res = await speak("hello", {
      model: "canopylabs/orpheus-v1-english",
      voice: "troy",
      format: "mp3",
      apiKey: { groq: "gk-test" },
    });
    expect(res.success).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
});
