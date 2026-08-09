import { describe, it, expect, afterEach } from "vitest";
import {
  getAllModels,
  getModel,
  getModelForProvider,
  isTextToSpeechModel,
  isSpeechToTextModel,
  modelSupportsInputModality,
  registerModelData,
  clearModelData,
} from "./models.js";
import type { ModelDataBlob } from "./modelData.js";

describe("audio model registry", () => {
  it("has the verified STT/TTS prices, providers, and registry inclusion", () => {
    const m = getModel("whisper-1")!;
    expect(isSpeechToTextModel(m)).toBe(true);
    if (!isSpeechToTextModel(m)) {
      throw new Error("expected STT model");
    }
    expect(m).toMatchObject({ provider: "openai", perMinuteCost: 0.006 });
    const expected = { "tts-1": 0.000015, "tts-1-hd": 0.00003 } as const;
    for (const [name, rate] of Object.entries(expected)) {
      const speech = getModel(name)!;
      expect(isTextToSpeechModel(speech)).toBe(true);
      if (!isTextToSpeechModel(speech)) {
        throw new Error("expected TTS model");
      }
      expect(speech).toMatchObject({ provider: "openai", perCharacterCost: rate });
    }
    const names = getAllModels().map((model) => model.modelName);
    expect(names).toEqual(expect.arrayContaining(["whisper-1", "tts-1", "tts-1-hd", "gpt-audio-1.5"]));
  });

  it("has exact audio-chat rates and modalities", () => {
    expect(modelSupportsInputModality("gpt-audio-1.5", "audio")).toBe(true);
    expect(getModel("gpt-audio-1.5")).toMatchObject({
      provider: "openai",
      modalities: { input: ["text", "audio"], output: ["text", "audio"] },
      inputTokenCost: 2.5,
      outputTokenCost: 10,
      inputAudioTokenCost: 32,
      outputAudioTokenCost: 64,
    });
  });

  it("whisper-web stub is gone", () => {
    expect(getModel("whisper-web")).toBeUndefined();
  });

  it("getModelForProvider matches on provider + name", () => {
    const md = {
      schemaVersion: 1, generatedAt: "t", hostedTools: [],
      models: [
        { type: "text", modelName: "dup", provider: "acme", maxInputTokens: 1,
          maxOutputTokens: 1, inputTokenCost: 99,
          modalities: { input: ["text", "audio"], output: ["text"] } },
        { type: "text", modelName: "dup", provider: "openai", maxInputTokens: 2,
          maxOutputTokens: 2, inputTokenCost: 7,
          modalities: { input: ["text"], output: ["text"] } },
      ],
    } satisfies ModelDataBlob;
    expect(getModelForProvider("acme", "dup", md)?.provider).toBe("acme");
    expect(getModelForProvider("openai", "dup", md)?.inputTokenCost).toBe(7);
  });

  describe("overlay precedence", () => {
    afterEach(() => {
      clearModelData();
    });

    it("layers baked-in < registered blob < request modelData for a colliding provider:modelName", () => {
      // Baked-in baseline: no overlay registered yet.
      const baseline = getModelForProvider("openai", "tts-1");
      expect(baseline?.perCharacterCost).toBe(0.000015);

      const registeredBlob = {
        schemaVersion: 1,
        generatedAt: "t",
        hostedTools: [],
        models: [
          {
            type: "text-to-speech",
            modelName: "tts-1",
            provider: "openai",
            perCharacterCost: 0.001,
          },
          {
            type: "text-to-speech",
            modelName: "tts-1",
            provider: "other-provider",
            perCharacterCost: 999,
          },
        ],
      } satisfies ModelDataBlob;
      registerModelData(registeredBlob);

      const afterRegister = getModelForProvider("openai", "tts-1");
      expect(afterRegister?.perCharacterCost).toBe(0.001);

      const requestBlob = {
        schemaVersion: 1,
        generatedAt: "t",
        hostedTools: [],
        models: [
          {
            type: "text-to-speech",
            modelName: "tts-1",
            provider: "openai",
            perCharacterCost: 0.002,
          },
        ],
      } satisfies ModelDataBlob;

      const afterRequest = getModelForProvider("openai", "tts-1", requestBlob);
      expect(afterRequest?.perCharacterCost).toBe(0.002);

      // The colliding modelName under a different provider never contributes
      // fields to the "openai" entry.
      expect(afterRequest?.provider).toBe("openai");
      const otherProviderEntry = getModelForProvider("other-provider", "tts-1", requestBlob);
      expect(otherProviderEntry?.perCharacterCost).toBe(999);
    });
  });
});
