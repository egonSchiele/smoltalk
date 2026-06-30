import { describe, it, expect } from "vitest";
import { validateModalities } from "./modalities.js";
import { userMessage, imagePart, filePart } from "../classes/message/index.js";

const image = { kind: "base64", base64: "IMG", mimeType: "image/png" } as const;
const pdf = { kind: "base64", base64: "PDF", mimeType: "application/pdf" } as const;

describe("validateModalities", () => {
  it("passes a string-only message", () => {
    expect(validateModalities({ model: "gpt-4o", messages: [userMessage("hi")] } as any)).toBeNull();
  });

  it("passes an image to a vision model (gpt-4o)", () => {
    expect(
      validateModalities({ model: "gpt-4o", messages: [userMessage(["x", imagePart(image)])] } as any),
    ).toBeNull();
  });

  it("fails an image to a text-only model", () => {
    const res = validateModalities({ model: "o3-mini", messages: [userMessage(["x", imagePart(image)])] } as any);
    expect(res).not.toBeNull();
    expect(res!.success).toBe(false);
  });

  it("passes when the model is unknown (no modalities data → no gate)", () => {
    expect(
      validateModalities({ model: "some-custom-vllm-model", provider: "openai-compat", messages: [userMessage(["x", imagePart(image)])] } as any),
    ).toBeNull();
  });

  it("fails a pdf to a model whose modalities lack pdf (o3-mini)", () => {
    const res = validateModalities({ model: "o3-mini", messages: [userMessage(["x", filePart(pdf)])] } as any);
    expect(res).not.toBeNull();
    expect(res!.success).toBe(false);
  });

  it("passes a pdf to a pdf-capable model (gpt-4o)", () => {
    expect(validateModalities({ model: "gpt-4o", messages: [userMessage(["x", filePart(pdf)])] } as any)).toBeNull();
  });
});
