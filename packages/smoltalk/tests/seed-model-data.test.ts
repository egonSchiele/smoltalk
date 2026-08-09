import { describe, it, expect } from "vitest";
import { buildSeedBlob } from "../scripts/seed-model-data.js";

describe("buildSeedBlob", () => {
  it("produces a valid blob carrying baseline models and hosted tools", () => {
    const blob = buildSeedBlob("2026-06-28T00:00:00Z");
    expect(blob.schemaVersion).toBe(1);
    expect(blob.generatedAt).toBe("2026-06-28T00:00:00Z");
    expect(blob.models.find((m) => m.modelName === "claude-opus-4-8")).toBeTruthy();
    expect(blob.hostedTools.find((t) => t.name === "web_search")).toBeTruthy();
  });

  it("carries the audio STT/TTS catalog and drops the whisper-web stub", () => {
    const blob = buildSeedBlob("2026-06-28T00:00:00Z");
    expect(blob.models.find((m) => m.modelName === "whisper-1")).toBeTruthy();
    expect(blob.models.find((m) => m.modelName === "tts-1")).toBeTruthy();
    expect(blob.models.find((m) => m.modelName === "tts-1-hd")).toBeTruthy();
    expect(blob.models.find((m) => m.modelName === "gpt-audio-1.5")).toBeTruthy();
    expect(blob.models.find((m) => m.modelName === "whisper-web")).toBeUndefined();
  });
});

import { readFileSync } from "node:fs";
import { getModelForProvider } from "../lib/models.js";

describe("committed data/model-data.json", () => {
  it("carries the audio constraint fields from the baked registry", () => {
    const blob = JSON.parse(readFileSync(new URL("../data/model-data.json", import.meta.url), "utf8"));
    const committedWhisper = blob.models.find(
      (m: { modelName: string; provider: string }) => m.modelName === "whisper-1" && m.provider === "openai",
    );
    const bakedWhisper = getModelForProvider("openai", "whisper-1");
    if (committedWhisper === undefined || bakedWhisper?.type !== "speech-to-text") {
      throw new Error("missing committed or baked openai:whisper-1");
    }
    expect(committedWhisper.maxBytes).toBe(bakedWhisper.maxBytes);
    expect(committedWhisper.supportedMimeTypes).toEqual(bakedWhisper.supportedMimeTypes);

    for (const modelName of ["tts-1", "tts-1-hd"]) {
      const committed = blob.models.find(
        (m: { modelName: string; provider: string }) => m.modelName === modelName && m.provider === "openai",
      );
      const baked = getModelForProvider("openai", modelName);
      if (committed === undefined || baked?.type !== "text-to-speech") {
        throw new Error(`missing committed or baked openai:${modelName}`);
      }
      expect(committed.maxInputChars).toBe(baked.maxInputChars);
      expect(committed.speedRange).toEqual(baked.speedRange);
      expect(committed.formats).toEqual(baked.formats);
    }
  });
});
