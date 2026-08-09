import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { transcribe } from "./transcription.js";
import type { ModelDataBlob } from "./modelData.js";
import { registerTranscriptionProvider, _resetForTests } from "./transcription.js";
import { BaseTranscriptionClient } from "./transcription/baseTranscriptionClient.js";
import { success } from "./types/result.js";

// A fake provider whose _transcribe echoes success, so we can observe whether
// the base guard let the call through.
class FakeClient extends BaseTranscriptionClient {
  protected async _transcribe() {
    return success({ text: "ok" });
  }
}

const src = { kind: "bytes" as const, data: new Uint8Array([1]), mimeType: "audio/wav" };

describe("transcribe() audio-input guard (B1)", () => {
  beforeEach(() => registerTranscriptionProvider("fake", FakeClient));
  afterEach(() => _resetForTests());

  it("accepts a multimodal text model that lists audio input", async () => {
    const modelData: ModelDataBlob = {
      schemaVersion: 1,
      generatedAt: "test",
      hostedTools: [],
      models: [{
        type: "text", modelName: "fake-mm", provider: "fake",
        maxInputTokens: 1000, maxOutputTokens: 1000,
        modalities: { input: ["text", "audio"], output: ["text"] },
      }],
    };

    const res = await transcribe(src, { model: "fake-mm", provider: "fake", modelData });
    expect(res.success).toBe(true);
  });

  it("rejects a text model that does NOT list audio input", async () => {
    const modelData: ModelDataBlob = {
      schemaVersion: 1,
      generatedAt: "test",
      hostedTools: [],
      models: [{
        type: "text", modelName: "fake-textonly", provider: "fake",
        maxInputTokens: 1000, maxOutputTokens: 1000,
        modalities: { input: ["text"], output: ["text"] },
      }],
    };

    const res = await transcribe(src, { model: "fake-textonly", provider: "fake", modelData });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/cannot accept audio input/);
  });

  it("lets an unknown model flow through (provider is authority)", async () => {
    const res = await transcribe(src, { model: "totally-unknown", provider: "fake" });
    expect(res.success).toBe(true);
  });
});
