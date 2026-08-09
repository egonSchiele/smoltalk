import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

describe("OpenAiCompatSpeechClient", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({ arrayBuffer: async () => new Uint8Array([7, 7]).buffer });
    ctor.mockReset();
    delete process.env.OPENAI_COMPAT_BASE_URL;
    delete process.env.OPENAI_COMPAT_API_KEY;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses the configured base URL and compat key", async () => {
    const res = await speak("hi", {
      model: "any-tts",
      voice: "v",
      provider: "openai-compat",
      apiKey: { openAiCompat: "oc-key" },
      baseUrl: { openAiCompat: "https://compat.test/v1" },
    });

    expect(res.success).toBe(true);
    if (res.success) expect(Array.from(res.value.audio)).toEqual([7, 7]);
    expect(ctor).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "oc-key", baseURL: "https://compat.test/v1" }),
    );
    // Inherited OpenAI default format (mp3) applies for a generic compat endpoint.
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ response_format: "mp3" }),
      { signal: undefined },
    );
  });

  it("fails with a clear message when no base URL is configured", async () => {
    const res = await speak("hi", {
      model: "any-tts",
      voice: "v",
      provider: "openai-compat",
      apiKey: { openAiCompat: "oc-key" },
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/base URL required/i);
    expect(create).not.toHaveBeenCalled();
  });
});
