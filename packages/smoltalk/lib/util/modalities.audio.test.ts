import { describe, it, expect, afterEach } from "vitest";
import { getClient, registerProvider, unregisterProvider } from "../client.js";
import { BaseClient } from "../clients/baseClient.js";
import type { ClientAttachmentCapabilities } from "../clients/baseClient.js";
import { UserMessage, userMessage } from "../classes/message/index.js";
import type { ModelDataBlob } from "../modelData.js";
import type { Result, SmolConfig } from "../types.js";

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

const testKeys = { openAi: "sk-t", google: "g-t", anthropic: "a-t", openRouter: "or-t" };

// Run the client-level modality gate (BaseClient.prepareAttachments) without
// touching any SDK: construct the real client and call the protected hook.
async function prepare(config: SmolConfig): Promise<Result<SmolConfig>> {
  const client = getClient({
    ...config,
    apiKey: testKeys,
  } as SmolConfig & { model: string });
  const accessible = client as unknown as {
    prepareAttachments(c: SmolConfig): Promise<Result<SmolConfig>>;
  };
  return accessible.prepareAttachments(config);
}

describe("client-level audio gating (prepareAttachments)", () => {
  it("passes for gpt-audio-1.5 on openai", async () => {
    const r = await prepare({ model: "gpt-audio-1.5", messages: [audioMsg] });
    expect(r.success).toBe(true);
  });

  it("rejects a text-only model", async () => {
    const r = await prepare({ model: "gpt-4o-mini", messages: [audioMsg] });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("does not support audio input");
    }
  });

  it("rejects an unknown/unannotated model (undefined support is not true)", async () => {
    const r = await prepare({ model: "totally-unknown", provider: "openai", messages: [audioMsg] });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("does not support audio input");
    }
  });

  it("rejects a non-openai provider even if that model declares audio", async () => {
    const r = await prepare({ model: "gemini-3.1-pro-preview", messages: [audioMsg] });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain('Audio input is not supported by the "google" provider');
    }
  });

  it("rejects openai-responses with audio", async () => {
    const r = await prepare({ model: "gpt-audio-1.5", provider: "openai-responses", messages: [audioMsg] });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain('Audio input is not supported by the "openai-responses" provider');
    }
  });

  it("rejects openai-compat gateways with audio (no input_audio passthrough)", async () => {
    const r = await prepare({ model: "some-model", provider: "openrouter", messages: [audioMsg] });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain('Audio input is not supported by the "openrouter" provider');
    }
  });

  it("does not inherit audio capability from a same-named non-openai model", async () => {
    // "dup" is audio-capable under provider "acme" only; an openai override must not borrow it.
    const r = await prepare({ model: "dup", provider: "openai", modelData: dupMd, messages: [audioMsg] });
    expect(r.success).toBe(false);
  });

  it("passes for a custom OpenAI model that opts in via modelData", async () => {
    const r = await prepare({
      model: "my-custom-audio-model",
      provider: "openai",
      modelData: customOpenAiAudioMd,
      messages: [audioMsg],
    });
    expect(r.success).toBe(true);
  });

  it("uses the openai entry (audio) when provider is openai, ignoring the conflicting google entry", async () => {
    const r = await prepare({
      model: "conflict",
      provider: "openai",
      modelData: conflictingProvidersMd,
      messages: [audioMsg],
    });
    expect(r.success).toBe(true);
  });

  it("uses the google entry (no audio) when provider is google, ignoring the conflicting openai entry", async () => {
    const r = await prepare({
      model: "conflict",
      provider: "google",
      modelData: conflictingProvidersMd,
      messages: [audioMsg],
    });
    expect(r.success).toBe(false);
  });

  it("detects audio in a mixed text+audio message", async () => {
    const mixedMsg = new UserMessage([
      { type: "text", text: "transcribe this" },
      { type: "audio", source: { kind: "base64", base64: "AAAA", mimeType: "audio/wav" } },
    ]);
    const r = await prepare({ model: "gpt-4o-mini", messages: [mixedMsg] });
    expect(r.success).toBe(false);
  });

  it("does not gate a text-only message on audio", async () => {
    const r = await prepare({ model: "gpt-4o-mini", messages: [textMsg] });
    expect(r.success).toBe(true);
  });

  it("still rejects image input on a text-only model (regression)", async () => {
    const r = await prepare({ model: "gpt-3.5-turbo", messages: [imageMsg] });
    expect(r.success).toBe(false);
  });

  it("still rejects PDF input on a model without pdf support (regression)", async () => {
    const r = await prepare({ model: "gpt-4.1-nano", messages: [fileMsg] });
    expect(r.success).toBe(false);
  });

  it("still allows image input on an image-capable model (regression)", async () => {
    const r = await prepare({ model: "gpt-4o-mini", messages: [imageMsg] });
    expect(r.success).toBe(true);
  });

  it("leaves unknown-model non-audio behavior unchanged (no gate without image/pdf/audio)", async () => {
    const r = await prepare({ model: "totally-unknown", messages: [textMsg], provider: "openai" });
    expect(r.success).toBe(true);
  });
});

describe("custom client audio capability declarations", () => {
  afterEach(() => {
    unregisterProvider("acme-audio");
  });

  const acmeAudioMd = {
    schemaVersion: 1,
    generatedAt: "t",
    hostedTools: [],
    models: [
      {
        type: "text",
        modelName: "acme-model",
        provider: "acme-audio",
        maxInputTokens: 1,
        maxOutputTokens: 1,
        modalities: { input: ["text", "audio"], output: ["text"] },
      },
    ],
  } satisfies ModelDataBlob;

  it("honors a custom client's audio capability declaration (flac accepted)", async () => {
    class AcmeAudioClient extends BaseClient {
      protected override attachmentCapabilities(): ClientAttachmentCapabilities {
        return { inputModalities: [], audioFormats: ["flac"] };
      }
    }
    registerProvider("acme-audio", AcmeAudioClient as typeof BaseClient);

    const flacMsg = new UserMessage([
      { type: "audio", source: { kind: "base64", base64: "AAAA", mimeType: "audio/flac" } },
    ]);
    const config: SmolConfig = {
      model: "acme-model",
      provider: "acme-audio",
      modelData: acmeAudioMd,
      messages: [flacMsg],
    };
    const client = getClient(config as SmolConfig & { model: string });
    const accessible = client as unknown as {
      prepareAttachments(c: SmolConfig): Promise<Result<SmolConfig>>;
    };
    const r = await accessible.prepareAttachments(config);
    expect(r.success).toBe(true);
    if (r.success) {
      const parts = (r.value.messages[0] as UserMessage).getContentParts();
      expect(parts?.[0]).toMatchObject({
        type: "audio",
        source: { kind: "base64", mimeType: "audio/flac" },
      });
    }
  });

  it("a flac audioPart is still rejected by OpenAI's mp3/wav policy", async () => {
    const flacMsg = new UserMessage([
      { type: "audio", source: { kind: "base64", base64: "AAAA", mimeType: "audio/flac" } },
    ]);
    const r = await prepare({
      model: "my-custom-audio-model",
      provider: "openai",
      modelData: customOpenAiAudioMd,
      messages: [flacMsg],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("supports only mp3, wav");
    }
  });
});
