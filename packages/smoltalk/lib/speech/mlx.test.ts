import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { speak } from "../speech.js";
import type { ModelDataBlob } from "../modelData.js";

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

const okResponse = () => ({ arrayBuffer: async () => new Uint8Array([7, 7]).buffer });

function mlxSpeak(extra: Record<string, unknown> = {}) {
  return speak("hi", {
    model: "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit",
    voice: "ryan",
    provider: "mlx",
    ...extra,
  });
}

describe("MlxSpeechClient", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue(okResponse());
    ctor.mockReset();
    delete process.env.MLX_BASE_URL;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("is picked for provider mlx and needs no key", async () => {
    const res = await mlxSpeak();
    expect(res.success).toBe(true);
    expect(ctor).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "mlx-local" }));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("uses baseUrl.mlx, then MLX_BASE_URL, then the localhost default", async () => {
    await mlxSpeak({ baseUrl: { mlx: "http://127.0.0.1:9000/v1" } });
    expect(ctor).toHaveBeenLastCalledWith(
      expect.objectContaining({ baseURL: "http://127.0.0.1:9000/v1" }),
    );

    process.env.MLX_BASE_URL = "http://127.0.0.1:9100/v1";
    await mlxSpeak();
    expect(ctor).toHaveBeenLastCalledWith(
      expect.objectContaining({ baseURL: "http://127.0.0.1:9100/v1" }),
    );

    delete process.env.MLX_BASE_URL;
    await mlxSpeak();
    expect(ctor).toHaveBeenLastCalledWith(
      expect.objectContaining({ baseURL: "http://127.0.0.1:8080/v1" }),
    );
  });

  it("never retries and waits up to ten minutes", async () => {
    await mlxSpeak();
    expect(ctor).toHaveBeenLastCalledWith(
      expect.objectContaining({ maxRetries: 0, timeout: 600_000 }),
    );
  });

  it("defaults to wav, and reports zero cost after the base class has run", async () => {
    const res = await mlxSpeak();
    expect(create).toHaveBeenLastCalledWith(
      expect.objectContaining({ response_format: "wav" }),
      expect.anything(),
    );
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.value.mimeType).toBe("audio/wav");
      expect(res.value.cost).toEqual({ inputCost: 0, outputCost: 0, totalCost: 0, currency: "USD" });
    }
  });

  it("reports zero cost even when model data prices the model", async () => {
    const priced = {
      schemaVersion: 1,
      generatedAt: "t",
      hostedTools: [],
      models: [
        {
          type: "text-to-speech",
          modelName: "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit",
          provider: "mlx",
          perCharacterCost: 0.001,
        },
      ],
    } satisfies ModelDataBlob;
    const res = await mlxSpeak({ modelData: priced });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.value.cost).toEqual({ inputCost: 0, outputCost: 0, totalCost: 0, currency: "USD" });
    }
  });

  it("labels pcm output as 24 kHz, 16-bit, mono", async () => {
    const res = await mlxSpeak({ format: "pcm" });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.value.mimeType).toBe("application/octet-stream");
      expect(res.value.pcm).toEqual({ sampleRateHz: 24000, sampleFormat: "s16le", channels: 1 });
    }
  });

  it("passes a request failure through with the server's message", async () => {
    create.mockRejectedValueOnce(new Error("Connection error."));
    const res = await mlxSpeak();
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toContain("Connection error.");
  });
});
