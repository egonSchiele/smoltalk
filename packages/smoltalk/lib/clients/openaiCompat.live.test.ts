/**
 * Real-API smoke tests for the generic openai-compat client. Runs only when
 * BOTH OPENAI_COMPAT_API_KEY and OPENAI_COMPAT_BASE_URL are set.
 *
 * Use this with any OpenAI-shape backend (vLLM, TGI, LM Studio, OpenLLM, etc.).
 */
import { describe, it, expect } from "vitest";
import { text } from "../functions.js";
import { userMessage } from "../classes/message/index.js";

const KEY = process.env.OPENAI_COMPAT_API_KEY;
const BASE = process.env.OPENAI_COMPAT_BASE_URL;
const MODEL = process.env.OPENAI_COMPAT_MODEL;
const haveAll = Boolean(KEY && BASE && MODEL);
const d = haveAll ? describe : describe.skip;

d("openai-compat (live)", () => {
  it("hello world", { timeout: 60_000 }, async () => {
    const r = await text({
      model: MODEL!,
      provider: "openai-compat",
      apiKey: { openAiCompat: KEY! },
      baseUrl: { openAiCompat: BASE! },
      messages: [userMessage("Reply with the single word: ping")],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.value.output!.length).toBeGreaterThan(0);
    }
  });
});
