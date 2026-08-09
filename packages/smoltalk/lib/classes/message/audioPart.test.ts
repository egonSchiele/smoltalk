import { describe, it, expect } from "vitest";
import { UserMessage, audioPart, messageFromJSON } from "./index.js";

describe("AudioPart", () => {
  it("builds and round-trips through JSON", () => {
    const source = { kind: "base64" as const, base64: "AQID", mimeType: "audio/wav" };
    const msg = new UserMessage([audioPart(source, { filename: "clip.wav" })]);
    const back = messageFromJSON(JSON.parse(JSON.stringify(msg.toJSON()))) as UserMessage;
    expect(back.getContentParts()![0]).toEqual({ type: "audio", source, filename: "clip.wav" });
  });

  it("omits filename when not provided", () => {
    const source = { kind: "base64" as const, base64: "AQID", mimeType: "audio/mpeg" };
    const part = audioPart(source);
    expect(part).toEqual({ type: "audio", source });
    expect("filename" in part).toBe(false);
  });

  it("serializes bytes to exact base64 through JSON round trip", () => {
    const bytesSource = { kind: "bytes" as const, data: new Uint8Array([1, 2, 3]), mimeType: "audio/wav" };
    const msg = new UserMessage([audioPart(bytesSource)]);
    const json = msg.toJSON();
    const serialized = json.content as any[];
    expect(serialized[0]).toEqual({
      type: "audio",
      source: { kind: "base64", base64: "AQID", mimeType: "audio/wav" },
      filename: undefined,
    });
  });

  it("throws for audio parts when serializing to Ollama messages", () => {
    const source = { kind: "base64" as const, base64: "AQID", mimeType: "audio/wav" };
    const msg = new UserMessage([audioPart(source)]);
    expect(() => msg.toOllamaMessage()).toThrow("Ollama does not support audio input.");
  });
});
