import { describe, it, expect } from "vitest";
import {
  UserContentSchema,
  ImagePartSchema,
  FilePartSchema,
  ProviderFileRefSchema,
  AttachmentSourceSchema,
} from "./contentParts.js";

describe("ProviderFileRef schema", () => {
  it("parses full + minimal refs", () => {
    const full = { kind: "providerFile", provider: "google", id: "files/abc", uri: "u", mimeType: "application/pdf", expiresAt: 1780000000000 };
    expect(ProviderFileRefSchema.parse(full)).toEqual(full);
    expect(ProviderFileRefSchema.parse({ kind: "providerFile", provider: "openai", id: "file-1" })).toBeTruthy();
  });
  it("rejects a ref missing id", () => {
    expect(ProviderFileRefSchema.safeParse({ kind: "providerFile", provider: "openai" }).success).toBe(false);
  });
  it("AttachmentSourceSchema accepts providerFile and image refs, rejects an unknown kind", () => {
    expect(AttachmentSourceSchema.safeParse({ kind: "providerFile", provider: "anthropic", id: "file_1" }).success).toBe(true);
    expect(AttachmentSourceSchema.safeParse({ kind: "base64", base64: "AAA", mimeType: "image/png" }).success).toBe(true);
    expect(AttachmentSourceSchema.safeParse({ kind: "blob" }).success).toBe(false);
  });
});

describe("content part schemas", () => {
  it("accepts a plain string as user content", () => {
    expect(UserContentSchema.parse("hello")).toBe("hello");
  });

  it("accepts a mixed parts array", () => {
    const content = [
      { type: "text", text: "what is this?" },
      { type: "image", source: { kind: "base64", base64: "AAA", mimeType: "image/png" } },
      { type: "file", source: { kind: "url", url: "https://x/y.pdf" }, filename: "y.pdf" },
    ];
    expect(UserContentSchema.parse(content)).toEqual(content);
  });

  it("parses an image part with a base64 source", () => {
    const part = { type: "image", source: { kind: "base64", base64: "AAA", mimeType: "image/png" } };
    expect(ImagePartSchema.parse(part)).toEqual(part);
  });

  it("rejects an image part with no source", () => {
    expect(() => ImagePartSchema.parse({ type: "image" })).toThrow();
  });

  it("parses a file part with optional filename omitted", () => {
    const part = { type: "file", source: { kind: "base64", base64: "AAA", mimeType: "application/pdf" } };
    expect(FilePartSchema.parse(part)).toEqual(part);
  });
});
