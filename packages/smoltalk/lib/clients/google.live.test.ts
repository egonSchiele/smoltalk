/**
 * Real-API smoke tests for the Google Gemini provider.
 * Runs only with GEMINI_API_KEY set, via `pnpm test:live`.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { text, textStream, userMessage } from "../index.js";
import type { StreamChunk } from "../types.js";

const MODEL = "gemini-2.5-flash-lite";
const THINKING_MODEL = "gemini-3-flash-preview";
const TIMEOUT = 60_000;

const haveKey = Boolean(process.env.GEMINI_API_KEY);

describe.runIf(haveKey).concurrent("Google - real API", () => {
  it("hello world", { timeout: TIMEOUT }, async () => {
    const r = await text({
      model: MODEL,
      messages: [userMessage("Reply with the single word: ping")],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.value.output!.length).toBeGreaterThan(0);
  });

  it("tool calling", { timeout: TIMEOUT }, async () => {
    const addTool = {
      name: "add",
      description: "Adds two integers.",
      schema: z.object({
        a: z.number().describe("first integer"),
        b: z.number().describe("second integer"),
      }),
    };
    const r = await text({
      model: MODEL,
      messages: [userMessage("Use the add tool to add 3 and 4. Do not answer in prose.")],
      tools: [addTool],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.value.toolCalls.length).toBeGreaterThan(0);
      const call = r.value.toolCalls[0];
      expect(call.name).toBe("add");
      const args = typeof call.args === "string" ? JSON.parse(call.args) : call.args;
      expect(typeof args.a).toBe("number");
      expect(typeof args.b).toBe("number");
    }
  });

  it("structured output (responseFormat)", { timeout: TIMEOUT }, async () => {
    const schema = z.object({ count: z.number() });
    const r = await text({
      model: MODEL,
      messages: [userMessage("How many planets in our solar system? Respond as JSON only.")],
      responseFormat: schema,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      const parsed = typeof r.value.output === "string"
        ? JSON.parse(r.value.output)
        : r.value.output;
      expect(schema.safeParse(parsed).success).toBe(true);
    }
  });

  it("streaming", { timeout: TIMEOUT }, async () => {
    const chunks: StreamChunk[] = [];
    for await (const c of textStream({
      model: MODEL,
      messages: [userMessage("Count to three. Just the numbers.")],
      stream: true,
    })) {
      chunks.push(c);
    }
    expect(chunks.some((c) => c.type === "text")).toBe(true);
    expect(chunks.some((c) => c.type === "done")).toBe(true);
  });

  it("cost/usage in result", { timeout: TIMEOUT }, async () => {
    const r = await text({
      model: MODEL,
      messages: [userMessage("Reply with one word.")],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.value.usage!.inputTokens).toBeGreaterThan(0);
      expect(r.value.cost!.totalCost).toBeGreaterThan(0);
    }
  });

  it("thinking / thought signatures", { timeout: TIMEOUT }, async () => {
    const r = await text({
      model: THINKING_MODEL,
      messages: [userMessage("What is 17 * 23? Think step by step.")],
      thinking: { enabled: true },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.value.thinkingBlocks).toBeDefined();
      expect(r.value.thinkingBlocks!.length).toBeGreaterThan(0);
    }
  });
});
