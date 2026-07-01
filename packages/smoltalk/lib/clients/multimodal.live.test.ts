import { describe, it, expect } from "vitest";
import { textSync } from "../functions.js";
import { userMessage, imagePart } from "../classes/message/index.js";

// A 64x64 RGB checkerboard PNG, inlined so no binary fixture is needed. It must
// be a real image with dimensions: OpenAI and Anthropic reject a degenerate 1x1
// image with "Could not process image" (Gemini tolerates it).
const PNG_64x64_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAk0lEQVR4nO3PsQ2AABDDQMZh/3lYg54FSEFlLPn1pYvccY+7zvP1/9YffxsUgB4UgB4UgB70GWAZuvoAdB+A7gPQvR9gGbr6AHQfgO4D0L0fYBm6+gB0H4DuA9C9H2AZuvoAdB+A7gPQvR9gGbr6AHQfgO4D0L0fYBm6+gB0H4DuA9C9H2AZuvoAdB+A7gPQvR7wAIuiWeEFLZN7AAAAAElFTkSuQmCC";

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
            imagePart({ kind: "base64", base64: PNG_64x64_BASE64, mimeType: "image/png" }),
          ]),
        ],
      });
      expect(res.success).toBe(true);
      if (res.success) expect(typeof res.value.output).toBe("string");
    });
  }
});
