import { describe, it, expect } from "vitest";
import { normalizeGoogleAudioUsage } from "./googleAudioUsage.js";
import type { GenerateContentResponseUsageMetadata } from "@google/genai";

describe("normalizeGoogleAudioUsage", () => {
  it("splits the audio bucket out of prompt tokens for STT (input)", () => {
    const meta = {
      promptTokenCount: 1100,
      promptTokensDetails: [{ modality: "AUDIO", tokenCount: 1000 }],
      candidatesTokenCount: 20,
      totalTokenCount: 1120,
    } as unknown as GenerateContentResponseUsageMetadata;

    expect(normalizeGoogleAudioUsage(meta, "input")).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      inputAudioTokens: 1000,
      totalTokens: 1120,
    });
  });

  it("splits the audio bucket out of candidate tokens for TTS (output)", () => {
    const meta = {
      promptTokenCount: 10,
      candidatesTokenCount: 200,
      candidatesTokensDetails: [{ modality: "AUDIO", tokenCount: 200 }],
      totalTokenCount: 210,
    } as unknown as GenerateContentResponseUsageMetadata;

    expect(normalizeGoogleAudioUsage(meta, "output")).toEqual({
      inputTokens: 10,
      outputTokens: 0,
      outputAudioTokens: 200,
      totalTokens: 210,
    });
  });

  it("falls back to all candidate tokens as audio output when details are absent", () => {
    const meta = {
      promptTokenCount: 5,
      candidatesTokenCount: 150,
      totalTokenCount: 155,
    } as unknown as GenerateContentResponseUsageMetadata;

    const usage = normalizeGoogleAudioUsage(meta, "output");
    expect(usage?.outputAudioTokens).toBe(150);
    expect(usage?.outputTokens).toBe(0);
  });

  it("trusts a present details array with no AUDIO entry (does not misprice text as audio)", () => {
    const meta = {
      promptTokenCount: 5,
      candidatesTokenCount: 150,
      candidatesTokensDetails: [{ modality: "TEXT", tokenCount: 150 }],
      totalTokenCount: 155,
    } as unknown as GenerateContentResponseUsageMetadata;

    const usage = normalizeGoogleAudioUsage(meta, "output");
    expect(usage?.outputAudioTokens).toBeUndefined();
    expect(usage?.outputTokens).toBe(150);
  });

  it("adds thinking tokens to the text-output bucket for STT", () => {
    const meta = {
      promptTokenCount: 1100,
      promptTokensDetails: [{ modality: "AUDIO", tokenCount: 1000 }],
      candidatesTokenCount: 20,
      thoughtsTokenCount: 30,
      totalTokenCount: 1150,
    } as unknown as GenerateContentResponseUsageMetadata;

    const usage = normalizeGoogleAudioUsage(meta, "input");
    expect(usage?.inputAudioTokens).toBe(1000);
    expect(usage?.outputTokens).toBe(50); // 20 candidates + 30 thoughts
  });

  it("keeps thinking tokens out of the audio-output bucket for TTS", () => {
    const meta = {
      promptTokenCount: 10,
      candidatesTokenCount: 200,
      candidatesTokensDetails: [{ modality: "AUDIO", tokenCount: 200 }],
      thoughtsTokenCount: 15,
      totalTokenCount: 225,
    } as unknown as GenerateContentResponseUsageMetadata;

    const usage = normalizeGoogleAudioUsage(meta, "output");
    expect(usage?.outputAudioTokens).toBe(200);
    expect(usage?.outputTokens).toBe(15); // audio split out, thoughts stay text
  });

  it("returns undefined when metadata is missing", () => {
    expect(normalizeGoogleAudioUsage(undefined, "input")).toBeUndefined();
  });
});
