import { describe, it, expect } from "vitest";
import { refToBase64, toDataUri, openAiImageUrl, anthropicSource } from "./attachments.js";

describe("url passthrough helpers", () => {
  it("openAiImageUrl passes a url ref through, data-URIs a base64 ref", () => {
    expect(openAiImageUrl({ kind: "url", url: "https://x/y.png" })).toBe("https://x/y.png");
    expect(openAiImageUrl({ kind: "base64", base64: "AAA", mimeType: "image/png" })).toBe(
      "data:image/png;base64,AAA",
    );
  });

  it("anthropicSource emits a url source or a base64 source", () => {
    expect(anthropicSource({ kind: "url", url: "https://x/y.png" })).toEqual({
      type: "url",
      url: "https://x/y.png",
    });
    expect(anthropicSource({ kind: "base64", base64: "AAA", mimeType: "image/png" })).toEqual({
      type: "base64",
      media_type: "image/png",
      data: "AAA",
    });
  });
});

describe("refToBase64", () => {
  it("passes through a base64 ref", () => {
    expect(refToBase64({ kind: "base64", base64: "AAA", mimeType: "image/png" })).toEqual({
      base64: "AAA",
      mimeType: "image/png",
    });
  });

  it("encodes a bytes ref", () => {
    const data = new Uint8Array([1, 2, 3]);
    expect(refToBase64({ kind: "bytes", data, mimeType: "image/png" })).toEqual({
      base64: Buffer.from(data).toString("base64"),
      mimeType: "image/png",
    });
  });

  it("throws on an unresolved path ref", () => {
    expect(() => refToBase64({ kind: "path", path: "./x.png" })).toThrow(/resolved/);
  });
});

describe("toDataUri", () => {
  it("builds a data URI", () => {
    expect(toDataUri("AAA", "image/png")).toBe("data:image/png;base64,AAA");
  });
});
