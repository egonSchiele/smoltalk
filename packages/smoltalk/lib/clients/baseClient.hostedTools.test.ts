import { describe, it, expect } from "vitest";
import { textSync } from "../functions.js";
import { UserMessage } from "../classes/message/index.js";

describe("hosted-tool validation runs before any network call", () => {
  it("fails fast for a model whose provider lacks the capability", async () => {
    const result = await textSync({
      model: "gpt-4o", // openai chat — no hosted web_search
      hostedTools: ["web_search"],
      messages: [new UserMessage("hi")],
      openAiApiKey: "sk-not-used",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("web_search");
  });
});
