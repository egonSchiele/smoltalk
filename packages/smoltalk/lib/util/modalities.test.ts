import { describe, it, expect } from "vitest";
import { neededInputModalities } from "./modalities.js";
import { getClient } from "../client.js";
import { userMessage, imagePart, filePart } from "../classes/message/index.js";
import type { Result, SmolConfig } from "../types.js";

const image = { kind: "base64", base64: "IMG", mimeType: "image/png" } as const;
const pdf = { kind: "base64", base64: "PDF", mimeType: "application/pdf" } as const;

const testKeys = { openAi: "sk-t", google: "g-t", anthropic: "a-t", openAiCompat: "c-t" };

// Run the client-level modality gate (BaseClient.prepareAttachments) without
// touching any SDK: construct the real client and call the protected hook.
async function prepare(config: SmolConfig): Promise<Result<SmolConfig>> {
  const client = getClient({
    ...config,
    apiKey: testKeys,
    baseUrl: { openAiCompat: "http://localhost:9999/v1" },
  } as SmolConfig & { model: string });
  const accessible = client as unknown as {
    prepareAttachments(c: SmolConfig): Promise<Result<SmolConfig>>;
  };
  return accessible.prepareAttachments(config);
}

describe("neededInputModalities", () => {
  it("collects image/pdf/audio needs from user messages", () => {
    const msg = userMessage([
      "x",
      imagePart(image),
      { type: "audio", source: { kind: "base64", base64: "AAAA", mimeType: "audio/wav" } },
    ]);
    const needed = neededInputModalities([msg]);
    expect(new Set(needed)).toEqual(new Set(["image", "audio"]));
  });

  it("maps file parts to the pdf modality", () => {
    const needed = neededInputModalities([userMessage(["x", filePart(pdf)])]);
    expect(needed).toEqual(["pdf"]);
  });

  it("returns nothing for text-only messages", () => {
    expect(neededInputModalities([userMessage("hi")])).toEqual([]);
  });
});

describe("client-level modality gate (prepareAttachments)", () => {
  it("passes a string-only message", async () => {
    const r = await prepare({ model: "gpt-4o", messages: [userMessage("hi")] });
    expect(r.success).toBe(true);
  });

  it("passes an image to a vision model (gpt-4o)", async () => {
    const r = await prepare({ model: "gpt-4o", messages: [userMessage(["x", imagePart(image)])] });
    expect(r.success).toBe(true);
  });

  it("fails an image to a text-only model", async () => {
    const r = await prepare({ model: "o3-mini", messages: [userMessage(["x", imagePart(image)])] });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("does not support image input");
    }
  });

  it("passes when the model is unknown (no modalities data → no gate for image)", async () => {
    const r = await prepare({
      model: "some-custom-vllm-model",
      provider: "openai-compat",
      messages: [userMessage(["x", imagePart(image)])],
    });
    expect(r.success).toBe(true);
  });

  it("fails a pdf to a model whose modalities lack pdf (o3-mini)", async () => {
    const r = await prepare({ model: "o3-mini", messages: [userMessage(["x", filePart(pdf)])] });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("does not support pdf input");
    }
  });

  it("passes a pdf to a pdf-capable model (gpt-4o)", async () => {
    const r = await prepare({ model: "gpt-4o", messages: [userMessage(["x", filePart(pdf)])] });
    expect(r.success).toBe(true);
  });
});
