import { describe, it, expect } from "vitest";
import {
  UserContentSchema,
  ImagePartSchema,
  FilePartSchema,
  mapContentParts,
} from "./contentParts.js";

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

describe("mapContentParts", () => {
  it("wraps a plain string as a single text result", () => {
    const out = mapContentParts("hi", {
      onText: (p) => `T:${p.text}`,
      onImage: () => "I",
      onFile: () => "F",
    });
    expect(out).toEqual(["T:hi"]);
  });

  it("dispatches each part to the matching visitor branch", () => {
    const content = [
      { type: "text", text: "a" },
      { type: "image", source: { kind: "base64", base64: "X", mimeType: "image/png" } },
      { type: "file", source: { kind: "base64", base64: "Y", mimeType: "application/pdf" } },
    ] as const;
    const out = mapContentParts(content as any, {
      onText: (p) => `T:${p.text}`,
      onImage: () => "I",
      onFile: () => "F",
    });
    expect(out).toEqual(["T:a", "I", "F"]);
  });
});
