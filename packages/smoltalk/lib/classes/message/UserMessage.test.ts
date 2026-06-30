import { describe, it, expect } from "vitest";
import { UserMessage } from "./UserMessage.js";
import { userMessage, imagePart, filePart, textPart } from "./index.js";

const img = { kind: "base64", base64: "AAA", mimeType: "image/png" } as const;
const image = { kind: "base64", base64: "IMG", mimeType: "image/png" } as const;
const pdf = { kind: "base64", base64: "PDF", mimeType: "application/pdf" } as const;

describe("UserMessage content model", () => {
  it("keeps a plain string as content", () => {
    const m = new UserMessage("hello");
    expect(m.content).toBe("hello");
    expect(m._content).toBe("hello");
  });

  it("normalizes a bare string element into a text part", () => {
    const m = userMessage(["describe this", imagePart(img)]);
    expect(Array.isArray(m._content)).toBe(true);
    expect((m._content as any[])[0]).toEqual({ type: "text", text: "describe this" });
  });

  it("content getter returns concatenated text of text parts only", () => {
    const m = userMessage([textPart("a"), imagePart(img), textPart("b")]);
    expect(m.content).toBe("a\nb");
  });

  it("builders produce the right shapes", () => {
    expect(imagePart(img)).toEqual({ type: "image", source: img });
    expect(filePart(img, { filename: "y.pdf" })).toEqual({ type: "file", source: img, filename: "y.pdf" });
    expect(textPart("hi")).toEqual({ type: "text", text: "hi" });
  });

  it("round-trips parts through toJSON/fromJSON, encoding bytes to base64", () => {
    const bytes = { kind: "bytes", data: new Uint8Array([1, 2, 3]), mimeType: "image/png" } as const;
    const m = userMessage(["look", imagePart(bytes)]);
    const json = m.toJSON();
    const source = (json.content as any[])[1].source;
    expect(source.kind).toBe("base64");
    expect(source.base64).toBe(Buffer.from(bytes.data).toString("base64"));
    const back = UserMessage.fromJSON(json);
    expect((back._content as any[])[1].source.base64).toBe(source.base64);
  });

  it("round-trips a file part with filename", () => {
    const m = userMessage([filePart({ kind: "base64", base64: "PDF", mimeType: "application/pdf" }, { filename: "r.pdf" })]);
    const back = UserMessage.fromJSON(m.toJSON());
    const part: any = (back._content as any[])[0];
    expect(part).toEqual({ type: "file", source: { kind: "base64", base64: "PDF", mimeType: "application/pdf" }, filename: "r.pdf" });
  });

  it("getContentParts returns null for string content, the array otherwise", () => {
    expect(new UserMessage("hi").getContentParts()).toBeNull();
    expect(userMessage([textPart("a")]).getContentParts()).toEqual([{ type: "text", text: "a" }]);
  });

  it("the content setter normalizes an input array", () => {
    const m = new UserMessage("hi");
    m.content = ["a", imagePart(img)] as any;
    expect(Array.isArray(m._content)).toBe(true);
    expect((m._content as any[])[0]).toEqual({ type: "text", text: "a" });
  });
});

describe("UserMessage.toOpenAIMessage", () => {
  it("keeps string content as a bare string", () => {
    expect(userMessage("hi").toOpenAIMessage()).toEqual({ role: "user", content: "hi", name: undefined });
  });

  it("emits image_url and file parts", () => {
    const msg = userMessage(["look", imagePart(image), filePart(pdf, { filename: "r.pdf" })]).toOpenAIMessage();
    expect(msg.content).toEqual([
      { type: "text", text: "look" },
      { type: "image_url", image_url: { url: "data:image/png;base64,IMG" } },
      { type: "file", file: { file_data: "data:application/pdf;base64,PDF", filename: "r.pdf" } },
    ]);
  });

  it("passes a remote image url straight through", () => {
    const msg = userMessage([imagePart({ kind: "url", url: "https://x/y.png" })]).toOpenAIMessage();
    expect(msg.content).toEqual([{ type: "image_url", image_url: { url: "https://x/y.png" } }]);
  });

  it("defaults the file part filename to attachment.pdf when omitted", () => {
    const msg = userMessage([filePart(pdf)]).toOpenAIMessage();
    expect(msg.content).toEqual([
      { type: "file", file: { file_data: "data:application/pdf;base64,PDF", filename: "attachment.pdf" } },
    ]);
  });

  it("throws if an unresolved path source reaches the serializer (safety net)", () => {
    expect(() => userMessage([filePart({ kind: "path", path: "/x.pdf" })]).toOpenAIMessage()).toThrow(/resolved/);
  });
});

describe("UserMessage.toOpenAIResponseInputItem", () => {
  it("keeps string content as a string", () => {
    expect(userMessage("hi").toOpenAIResponseInputItem()).toEqual({
      type: "message",
      role: "user",
      content: "hi",
    });
  });

  it("emits input_text, input_image, input_file parts", () => {
    const item: any = userMessage(["look", imagePart(image), filePart(pdf, { filename: "r.pdf" })]).toOpenAIResponseInputItem();
    expect(item.content).toEqual([
      { type: "input_text", text: "look" },
      { type: "input_image", image_url: "data:image/png;base64,IMG", detail: "auto" },
      { type: "input_file", file_data: "data:application/pdf;base64,PDF", filename: "r.pdf" },
    ]);
  });

  it("defaults the filename to attachment.pdf when omitted", () => {
    const item: any = userMessage([filePart(pdf)]).toOpenAIResponseInputItem();
    expect(item.content[0]).toEqual({
      type: "input_file",
      file_data: "data:application/pdf;base64,PDF",
      filename: "attachment.pdf",
    });
  });

  it("passes a pdf url through as file_url", () => {
    const item: any = userMessage([filePart({ kind: "url", url: "https://x/y.pdf" })]).toOpenAIResponseInputItem();
    expect(item.content[0]).toEqual({ type: "input_file", file_url: "https://x/y.pdf" });
  });
});

describe("UserMessage.toGoogleMessage", () => {
  it("keeps string content as a single text part", () => {
    expect(userMessage("hi").toGoogleMessage()).toEqual({ role: "user", parts: [{ text: "hi" }] });
  });

  it("emits inlineData parts for image and pdf", () => {
    const msg: any = userMessage(["look", imagePart(image), filePart(pdf)]).toGoogleMessage();
    expect(msg.parts).toEqual([
      { text: "look" },
      { inlineData: { mimeType: "image/png", data: "IMG" } },
      { inlineData: { mimeType: "application/pdf", data: "PDF" } },
    ]);
  });
});

describe("UserMessage.toAnthropicMessage", () => {
  it("keeps string content as a string", () => {
    expect(userMessage("hi").toAnthropicMessage()).toEqual({ role: "user", content: "hi" });
  });

  it("emits image and document blocks", () => {
    const msg: any = userMessage(["look", imagePart(image), filePart(pdf)]).toAnthropicMessage();
    expect(msg.content).toEqual([
      { type: "text", text: "look" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "IMG" } },
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: "PDF" } },
    ]);
  });

  it("passes a url image through as a url source", () => {
    const msg: any = userMessage([imagePart({ kind: "url", url: "https://x/y.png" })]).toAnthropicMessage();
    expect(msg.content[0]).toEqual({ type: "image", source: { type: "url", url: "https://x/y.png" } });
  });
});

describe("UserMessage.toOllamaMessage", () => {
  it("keeps string content as a string with no images", () => {
    expect(userMessage("hi").toOllamaMessage()).toEqual({ role: "user", content: "hi" });
  });

  it("puts images in the images field and joins text", () => {
    const msg: any = userMessage(["look", imagePart(image)]).toOllamaMessage();
    expect(msg).toEqual({ role: "user", content: "look", images: ["IMG"] });
  });

  it("drops file parts (Ollama has no file support), keeping text + images", () => {
    const msg: any = userMessage(["look", imagePart(image), filePart(pdf)]).toOllamaMessage();
    expect(msg).toEqual({ role: "user", content: "look", images: ["IMG"] });
  });
});
