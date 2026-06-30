/**
 * Real-API smoke tests for LiteLLM. Runs only when BOTH LITELLM_API_KEY and
 * LITELLM_BASE_URL are set (requires a running LiteLLM proxy).
 */
import { describe, it, expect } from "vitest";
import { text } from "../functions.js";
import { userMessage } from "../classes/message/index.js";

const KEY = process.env.LITELLM_API_KEY;
const BASE = process.env.LITELLM_BASE_URL;
const haveBoth = Boolean(KEY && BASE);
const d = haveBoth ? describe : describe.skip;
// Model alias is set up in the user's litellm config; default to a common
// stand-in if not specified.
const MODEL = process.env.LITELLM_MODEL || "openai/gpt-4o-mini";

d("LiteLLM (live, via local proxy)", () => {
  it("hello world + cost from x-litellm-response-cost", { timeout: 60_000 }, async () => {
    const r = await text({
      model: MODEL,
      provider: "litellm",
      apiKey: { liteLlm: KEY! },
      baseUrl: { liteLlm: BASE! },
      messages: [userMessage("Reply with the single word: ping")],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      // LiteLLM is configured to return the cost header for chat completions.
      // If the user's proxy is not configured for cost tracking this assertion
      // will fail and they should adjust the model entry to include callback cost.
      expect(r.value.cost?.totalCost).toBeGreaterThan(0);
    }
  });
});
