import { describe, it, expect } from "vitest";
import { validateModalities } from "./modalities.js";
import { UserMessage } from "../classes/message/index.js";
import type { ModelDataBlob } from "../modelData.js";
import type { SmolConfig } from "../types.js";

const audioMsg = new UserMessage([
  { type: "audio", source: { kind: "base64", base64: "AAAA", mimeType: "audio/wav" } },
]);

const textMsg = new UserMessage([{ type: "text", text: "hello" }]);

const imageMsg = new UserMessage([
  { type: "image", source: { kind: "base64", base64: "AAAA", mimeType: "image/png" } },
]);

const fileMsg = new UserMessage([
  { type: "file", source: { kind: "base64", base64: "AAAA", mimeType: "application/pdf" }, filename: "doc.pdf" },
]);

const dupMd = {
  schemaVersion: 1,
  generatedAt: "t",
  hostedTools: [],
  models: [
    {
      type: "text",
      modelName: "dup",
      provider: "acme",
      maxInputTokens: 1,
      maxOutputTokens: 1,
      modalities: { input: ["text", "audio"], output: ["text"] },
    },
  ],
} satisfies ModelDataBlob;

const customOpenAiAudioMd = {
  schemaVersion: 1,
  generatedAt: "t",
  hostedTools: [],
  models: [
    {
      type: "text",
      modelName: "my-custom-audio-model",
      provider: "openai",
      maxInputTokens: 1,
      maxOutputTokens: 1,
      modalities: { input: ["text", "audio"], output: ["text"] },
    },
  ],
} satisfies ModelDataBlob;

const conflictingProvidersMd = {
  schemaVersion: 1,
  generatedAt: "t",
  hostedTools: [],
  models: [
    {
      type: "text",
      modelName: "conflict",
      provider: "openai",
      maxInputTokens: 1,
      maxOutputTokens: 1,
      modalities: { input: ["text", "audio"], output: ["text"] },
    },
    {
      type: "text",
      modelName: "conflict",
      provider: "google",
      maxInputTokens: 1,
      maxOutputTokens: 1,
      modalities: { input: ["text"], output: ["text"] },
    },
  ],
} satisfies ModelDataBlob;

describe("validateModalities — audio", () => {
  it("passes for gpt-audio-1.5 on openai", () => {
    const config = { model: "gpt-audio-1.5", messages: [audioMsg] } satisfies SmolConfig;
    expect(validateModalities(config)).toBeNull();
  });

  it("rejects a text-only model", () => {
    const config = { model: "gpt-4o-mini", messages: [audioMsg] } satisfies SmolConfig;
    expect(validateModalities(config)?.success).toBe(false);
  });

  it("rejects an unknown/unannotated model (undefined support is not true)", () => {
    const config = {
      model: "totally-unknown",
      provider: "openai",
      messages: [audioMsg],
    } satisfies SmolConfig;
    expect(validateModalities(config)?.success).toBe(false);
  });

  it("rejects a non-openai provider even if that model declares audio", () => {
    const config = { model: "gemini-3.1-pro-preview", messages: [audioMsg] } satisfies SmolConfig;
    expect(validateModalities(config)?.success).toBe(false);
  });

  it("rejects openai-responses with audio", () => {
    const config = {
      model: "gpt-audio-1.5",
      provider: "openai-responses",
      messages: [audioMsg],
    } satisfies SmolConfig;
    expect(validateModalities(config)?.success).toBe(false);
  });

  it("does not inherit audio capability from a same-named non-openai model", () => {
    // "dup" is audio-capable under provider "acme" only; an openai override must not borrow it.
    const config = {
      model: "dup",
      provider: "openai",
      modelData: dupMd,
      messages: [audioMsg],
    } satisfies SmolConfig;
    expect(validateModalities(config)?.success).toBe(false);
  });

  it("passes for a custom OpenAI model that opts in via modelData", () => {
    const config = {
      model: "my-custom-audio-model",
      provider: "openai",
      modelData: customOpenAiAudioMd,
      messages: [audioMsg],
    } satisfies SmolConfig;
    expect(validateModalities(config)).toBeNull();
  });

  it("uses the openai entry (audio) when provider is openai, ignoring the conflicting google entry", () => {
    const config = {
      model: "conflict",
      provider: "openai",
      modelData: conflictingProvidersMd,
      messages: [audioMsg],
    } satisfies SmolConfig;
    expect(validateModalities(config)).toBeNull();
  });

  it("uses the google entry (no audio) when provider is google, ignoring the conflicting openai entry", () => {
    const config = {
      model: "conflict",
      provider: "google",
      modelData: conflictingProvidersMd,
      messages: [audioMsg],
    } satisfies SmolConfig;
    expect(validateModalities(config)?.success).toBe(false);
  });

  it("detects audio in a mixed text+audio message", () => {
    const mixedMsg = new UserMessage([
      { type: "text", text: "transcribe this" },
      { type: "audio", source: { kind: "base64", base64: "AAAA", mimeType: "audio/wav" } },
    ]);
    const config = { model: "gpt-4o-mini", messages: [mixedMsg] } satisfies SmolConfig;
    expect(validateModalities(config)?.success).toBe(false);
  });

  it("does not gate a text-only message on audio", () => {
    const config = { model: "gpt-4o-mini", messages: [textMsg] } satisfies SmolConfig;
    expect(validateModalities(config)).toBeNull();
  });

  it("still rejects image input on a text-only model (regression)", () => {
    const config = { model: "gpt-3.5-turbo", messages: [imageMsg] } satisfies SmolConfig;
    expect(validateModalities(config)?.success).toBe(false);
  });

  it("still rejects PDF input on a model without pdf support (regression)", () => {
    const config = { model: "gpt-4.1-nano", messages: [fileMsg] } satisfies SmolConfig;
    expect(validateModalities(config)?.success).toBe(false);
  });

  it("still allows image input on an image-capable model (regression)", () => {
    const config = { model: "gpt-4o-mini", messages: [imageMsg] } satisfies SmolConfig;
    expect(validateModalities(config)).toBeNull();
  });

  it("leaves unknown-model non-audio behavior unchanged (no gate without image/pdf/audio)", () => {
    const config = { model: "totally-unknown", messages: [textMsg] } satisfies SmolConfig;
    expect(validateModalities(config)).toBeNull();
  });
});
