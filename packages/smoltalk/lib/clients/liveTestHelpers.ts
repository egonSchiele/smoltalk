/**
 * Shared helpers for live (real-API) provider smoke tests.
 *
 * Not exported from the package's public surface. Excluded from the dist
 * build via tsconfig so it doesn't ship in the published tarball.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { text, textStream } from "../functions.js";
import { userMessage } from "../classes/message/index.js";
import type { StreamChunk } from "../types.js";
import { stripCodeFence } from "../util/util.js";

const DEFAULT_TIMEOUT = 60_000;

const addTool = {
  name: "add",
  description: "Adds two integers.",
  schema: z.object({
    a: z.number().describe("first integer"),
    b: z.number().describe("second integer"),
  }),
};

const planetSchema = z.object({ count: z.number() });

export interface LiveProviderTestConfig {
  /** Display name in the describe block. */
  name: string;
  /** Env var that must be set for the suite to run. */
  envKey: string;
  /** Cheap model to use for the smoke tests. */
  model: string;
  /** Explicit provider override (only needed for non-default routing like openai-responses). */
  provider?: string;
  /** If set, runs an additional thinking-blocks test using this model. */
  thinkingModel?: string;
  /** Per-test timeout in ms. Defaults to 60s. */
  timeout?: number;
  /** Whether to pass `responseFormatOptions: { strict: true }` for structured output. */
  strictResponseFormat?: boolean;
}

export function liveProviderSuite(config: LiveProviderTestConfig): void {
  const haveKey = Boolean(process.env[config.envKey]);
  const timeout = config.timeout ?? DEFAULT_TIMEOUT;

  const baseConfig = config.provider
    ? { model: config.model, provider: config.provider }
    : { model: config.model };

  describe.runIf(haveKey).concurrent(`${config.name} - real API`, () => {
    it("hello world", { timeout }, async () => {
      const r = await text({
        ...baseConfig,
        messages: [userMessage("Reply with the single word: ping")],
      });
      expect(r.success).toBe(true);
      if (r.success) expect(r.value.output!.length).toBeGreaterThan(0);
    });

    it("tool calling", { timeout }, async () => {
      const r = await text({
        ...baseConfig,
        messages: [userMessage("Use the add tool to add 3 and 4. Do not answer in prose.")],
        tools: [addTool],
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.value.toolCalls.length).toBeGreaterThan(0);
        const call = r.value.toolCalls[0];
        expect(call.name).toBe("add");
        expect(typeof call.arguments.a).toBe("number");
        expect(typeof call.arguments.b).toBe("number");
      }
    });

    it("structured output (responseFormat)", { timeout }, async () => {
      const r = await text({
        ...baseConfig,
        // Be explicit about the schema in the prompt itself. Some providers
        // (notably Anthropic) don't send the schema natively unless strict
        // mode is enabled, so without an explicit hint the model invents
        // its own keys (e.g. "planets" instead of "count") and the test
        // flakes.
        messages: [
          userMessage(
            'How many planets in our solar system? Respond with raw JSON matching this exact schema: {"count": number}. Example: {"count": 5}',
          ),
        ],
        responseFormat: planetSchema,
        ...(config.strictResponseFormat
          ? { responseFormatOptions: { strict: true } }
          : {}),
      });
      expect(r.success).toBe(true);
      if (r.success) {
        // Some providers (notably Anthropic without strict response-format
        // mode) wrap JSON in markdown code fences despite the prompt asking
        // for raw JSON. Strip them defensively before parsing.
        const parsed =
          typeof r.value.output === "string"
            ? JSON.parse(stripCodeFence(r.value.output))
            : r.value.output;
        expect(planetSchema.safeParse(parsed).success).toBe(true);
      }
    });

    it("streaming", { timeout }, async () => {
      const chunks: StreamChunk[] = [];
      for await (const c of textStream({
        ...baseConfig,
        messages: [userMessage("Count to three. Just the numbers.")],
        stream: true,
      })) {
        chunks.push(c);
      }
      expect(chunks.some((c) => c.type === "text")).toBe(true);
      expect(chunks.some((c) => c.type === "done")).toBe(true);
    });

    it("cost/usage in result", { timeout }, async () => {
      const r = await text({
        ...baseConfig,
        messages: [userMessage("Reply with one word.")],
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.value.usage!.inputTokens).toBeGreaterThan(0);
        expect(r.value.usage!.outputTokens).toBeGreaterThan(0);
        expect(r.value.cost!.totalCost).toBeGreaterThan(0);
      }
    });

    if (config.thinkingModel) {
      const thinkingModel = config.thinkingModel;
      it("thinking / thought signatures", { timeout }, async () => {
        const r = await text({
          model: thinkingModel,
          messages: [userMessage("What is 17 * 23? Think step by step.")],
          thinking: { enabled: true, budgetTokens: 2000 },
        });
        expect(r.success).toBe(true);
        if (r.success) {
          expect(r.value.thinkingBlocks).toBeDefined();
          expect(r.value.thinkingBlocks!.length).toBeGreaterThan(0);
          expect(r.value.thinkingBlocks![0].text.length).toBeGreaterThan(0);
        }
      });
    }
  });
}
