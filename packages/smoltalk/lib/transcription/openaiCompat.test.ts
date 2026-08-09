import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

const src = { kind: "bytes" as const, data: new Uint8Array([1, 2, 3]), mimeType: "audio/wav" };

describe("OpenAiCompatTranscriptionClient", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({ text: "compat transcript", duration: 1 });
    ctor.mockReset();
    delete process.env.OPENAI_COMPAT_BASE_URL;
    delete process.env.OPENAI_COMPAT_API_KEY;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses the configured base URL and compat key", async () => {
    const res = await transcribe(src, {
      model: "any-model",
      provider: "openai-compat",
      apiKey: { openAiCompat: "oc-key" },
      baseUrl: { openAiCompat: "https://compat.test/v1" },
    });

    expect(res.success).toBe(true);
    if (res.success) expect(res.value.text).toBe("compat transcript");
    expect(ctor).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "oc-key", baseURL: "https://compat.test/v1" }),
    );
  });

  it("falls back to OPENAI_COMPAT_BASE_URL", async () => {
    process.env.OPENAI_COMPAT_BASE_URL = "https://env-compat.test/v1";
    const res = await transcribe(src, {
      model: "any-model",
      provider: "openai-compat",
      apiKey: { openAiCompat: "oc-key" },
    });
    expect(res.success).toBe(true);
    expect(ctor).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "https://env-compat.test/v1" }),
    );
  });

  it("fails with a clear message when no base URL is configured", async () => {
    const res = await transcribe(src, {
      model: "any-model",
      provider: "openai-compat",
      apiKey: { openAiCompat: "oc-key" },
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/base URL required/i);
    expect(create).not.toHaveBeenCalled();
  });
});
