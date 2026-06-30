import { describe, it, expect } from "vitest";
import { textSync } from "../functions.js";
import { userMessage, imagePart } from "../classes/message/index.js";

// A 1x1 transparent PNG, inlined so no binary fixture is needed.
const PNG_1x1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const cases = [
  { model: "gpt-4o", key: process.env.OPENAI_API_KEY },
  { model: "gemini-2.5-flash", key: process.env.GEMINI_API_KEY },
  { model: "claude-sonnet-4-5", key: process.env.ANTHROPIC_API_KEY },
];

describe("multimodal live", () => {
  for (const c of cases) {
    let run: typeof it | typeof it.skip = it.skip;
    if (c.key) {
      run = it;
    }
    run(`${c.model} accepts an image`, async () => {
      const res = await textSync({
        model: c.model as any,
        messages: [
          userMessage([
            "Reply with the single word OK.",
            imagePart({ kind: "base64", base64: PNG_1x1_BASE64, mimeType: "image/png" }),
          ]),
        ],
      });
      expect(res.success).toBe(true);
      if (res.success) expect(typeof res.value.output).toBe("string");
    });
  }
});
