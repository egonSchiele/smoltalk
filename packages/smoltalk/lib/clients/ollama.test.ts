import { describe, it, expect } from "vitest";
import { SmolOllama } from "./ollama.js";
import { userMessage, imagePart } from "../classes/message/index.js";

describe("Ollama client routes through toOllamaMessage", () => {
  it("sends images in the request's images field", async () => {
    const client = new SmolOllama({ model: "llama3.2", messages: [] } as any);
    let captured: any;
    // Replace the SDK client wholesale; _textSync only calls .chat here.
    (client as any).client = {
      chat: async (req: any) => {
        captured = req;
        return { message: { content: "ok" }, done: true };
      },
    };
    await client
      ._textSync({
        model: "llama3.2",
        messages: [userMessage(["look", imagePart({ kind: "base64", base64: "IMG", mimeType: "image/png" })])],
      } as any)
      .catch(() => {
        // ignore downstream cost/usage parsing — the assertion is on the captured request
      });
    expect(captured.messages[0]).toMatchObject({ role: "user", content: "look", images: ["IMG"] });
  });
});
