import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64, concatBytes, utf8ByteLength } from "./base64.js";

describe("base64", () => {
  const pairs: [string, string][] = [
    ["", ""],
    ["f", "Zg=="],
    ["fo", "Zm8="],
    ["foo", "Zm9v"],
    ["foobar", "Zm9vYmFy"],
  ];

  it("encodes known pairs", () => {
    for (const [text, b64] of pairs) {
      expect(bytesToBase64(new TextEncoder().encode(text))).toBe(b64);
    }
  });

  it("decodes base64url, as Buffer did", () => {
    expect(base64ToBytes("-_8=")).toEqual(new Uint8Array([251, 255]));
    expect(base64ToBytes("-_8")).toEqual(new Uint8Array([251, 255]));
    expect(base64ToBytes("+/8=")).toEqual(new Uint8Array([251, 255]));
  });

  it("throws on a stray character, unlike Buffer", () => {
    expect(() => base64ToBytes("Zm9v!!")).toThrow();
  });

  it("decodes known pairs", () => {
    for (const [text, b64] of pairs) {
      expect(new TextDecoder().decode(base64ToBytes(b64))).toBe(text);
    }
  });

  it("round-trips 1 MB of random bytes and agrees with Buffer", () => {
    const bytes = new Uint8Array(1024 * 1024);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
    const encoded = bytesToBase64(bytes);
    expect(encoded).toBe(Buffer.from(bytes).toString("base64"));
    expect(base64ToBytes(encoded)).toEqual(bytes);
  });

  it("decodes a Buffer-encoded string", () => {
    const bytes = new Uint8Array([0, 255, 128, 1, 2, 3]);
    expect(base64ToBytes(Buffer.from(bytes).toString("base64"))).toEqual(bytes);
  });
});

describe("concatBytes", () => {
  it("joins chunks in order", () => {
    const out = concatBytes([new Uint8Array([1, 2]), new Uint8Array([]), new Uint8Array([3])]);
    expect(out).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("accepts a known total", () => {
    expect(concatBytes([new Uint8Array([9, 8])], 2)).toEqual(new Uint8Array([9, 8]));
  });
});

describe("utf8ByteLength", () => {
  it("counts bytes, not characters", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("é")).toBe(2);
    expect(utf8ByteLength("日本")).toBe(6);
  });
});
