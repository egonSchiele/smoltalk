import { describe, it, expect } from "vitest";
import { redactAttachments } from "./redact.js";

describe("redactAttachments", () => {
  it("summarizes a base64 data URI", () => {
    const out: any = redactAttachments({ url: "data:image/png;base64," + "A".repeat(5000) });
    expect(out.url).toBe(`data:image/png;base64,[redacted ${"data:image/png;base64,".length + 5000} chars]`);
  });

  it("summarizes a long bare base64 string", () => {
    const out: any = redactAttachments({ data: "A".repeat(5000) });
    expect(out.data).toMatch(/^\[redacted 5000 base64 chars\]$/);
  });

  it("leaves normal prose untouched", () => {
    const text = "Describe this image in detail. ".repeat(10); // long but not base64
    expect((redactAttachments({ text }) as any).text).toBe(text);
  });

  it("recurses into arrays and nested objects", () => {
    const out: any = redactAttachments({ messages: [{ content: [{ image_url: { url: "data:image/png;base64," + "A".repeat(5000) } }] }] });
    expect(out.messages[0].content[0].image_url.url).toContain("[redacted");
  });
});
