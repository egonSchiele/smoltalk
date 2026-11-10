/**
 * Real-API smoke tests for the OpenAI Responses provider.
 * Runs only with OPENAI_API_KEY set, via `pnpm test:live`.
 */
import { env } from "#platform";
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { text } from "../functions.js";
import { assistantMessage, toolMessage, userMessage } from "../classes/message/index.js";
import { liveProviderSuite } from "./liveTestHelpers.js";

liveProviderSuite({
  name: "OpenAI Responses",
  envKey: "OPENAI_API_KEY",
  model: "gpt-4o-mini",
  provider: "openai-responses",
  strictResponseFormat: true,
});

// A two-request tool loop with a reasoning model. The first reply carries
// an encrypted reasoning item with its function call. The second request
// sends that item back, with its id and encrypted_content, and must be
// accepted. smoltalk sets no `store`, so OpenAI's default applies.
const haveKey = Boolean(env("OPENAI_API_KEY"));
describe.runIf(haveKey)("OpenAI Responses - reasoning sent back", () => {
  it("accepts a reasoning item sent back with its function call", { timeout: 120_000 }, async () => {
    const base = { model: "gpt-5-mini", provider: "openai-responses", maxTokens: 4000 };
    const addTool = {
      name: "add",
      description: "Adds two integers.",
      schema: z.object({ a: z.number(), b: z.number() }),
    };
    const first = await text({
      ...base,
      messages: [userMessage("Use the add tool to add 3 and 4, then say the result.")],
      tools: [addTool],
    });
    expect(first.success).toBe(true);
    if (!first.success) return;
    expect(first.value.reasoningRecord?.format).toBe("responsesItems");
    const call = first.value.toolCalls[0];
    const second = await text({
      ...base,
      messages: [
        userMessage("Use the add tool to add 3 and 4, then say the result."),
        assistantMessage(null, {
          toolCalls: first.value.toolCalls,
          reasoning: first.value.reasoningRecord,
        }),
        toolMessage("7", { tool_call_id: call.id, name: call.name }),
      ],
      tools: [addTool],
    });
    expect(second.success).toBe(true);
  });
});
