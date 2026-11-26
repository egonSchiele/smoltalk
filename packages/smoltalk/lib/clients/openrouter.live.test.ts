/**
 * Real-API smoke tests for OpenRouter. Runs only with OPENROUTER_API_KEY set,
 * via `pnpm test:live`.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { text, textStream } from "../functions.js";
import {
  assistantMessage,
  systemMessage,
  toolMessage,
  userMessage,
} from "../classes/message/index.js";
import { liveProviderSuite } from "./liveTestHelpers.js";

// Reuse the shared smoke suite for hello-world/tools/structured/streaming/cost.
liveProviderSuite({
  name: "OpenRouter",
  envKey: "OPENROUTER_API_KEY",
  provider: "openrouter",
  model: "openai/gpt-4o-mini",
});

const KEY = process.env.OPENROUTER_API_KEY;
const d = KEY ? describe : describe.skip;

d("OpenRouter - hosted web_search", () => {
  it(
    "returns web_search citations when hostedTools requests it",
    { timeout: 60_000 },
    async () => {
      const r = await text({
        model: "openai/gpt-4o-mini",
        provider: "openrouter",
        apiKey: { openRouter: KEY! },
        messages: [
          userMessage(
            "Find a recent news headline about TypeScript releases. Cite the URL.",
          ),
        ],
        hostedTools: ["web_search"],
        maxTokens: 400,
      });
      expect(r.success).toBe(true);
      if (r.success) {
        const ws = r.value.hostedToolResults?.find(
          (h) => h.tool === "web_search",
        );
        expect(ws).toBeDefined();
        expect(ws?.provider).toBe("openrouter");
        expect((ws?.sources?.length ?? 0) + (ws?.citations?.length ?? 0)).toBeGreaterThan(
          0,
        );
      }
    },
  );
});

d("OpenRouter - prompt caching for Anthropic models", () => {
  // Over the 512-token minimum for Haiku 5.5, and unique per run so the
  // first call is a cache write rather than a read of an earlier run's cache.
  const longSystem =
    `Run ${Date.now()}. You answer questions about a parts catalog.\n` +
    Array.from({ length: 200 }, (_, i) => `Part ${i}: a widget of size ${i} mm.`).join("\n");
  const lookup = {
    name: "lookup",
    description: "Look up a part by number",
    schema: z.object({ part: z.number() }),
  };

  it(
    "writes the cache on a tool loop's first call and reads it on the next",
    { timeout: 120_000 },
    async () => {
      const base = {
        model: "anthropic/claude-haiku-5.5",
        provider: "openrouter",
        apiKey: { openRouter: KEY! },
        tools: [lookup],
        maxTokens: 300,
      } as const;
      const first = await text({
        ...base,
        messages: [
          systemMessage(longSystem),
          userMessage("Use the lookup tool to look up part 7."),
        ],
      });
      expect(first.success).toBe(true);
      if (!first.success) return;
      const call = first.value.toolCalls[0];
      expect(call).toBeDefined();
      const firstUsage = first.value.usage;
      expect(firstUsage?.cacheCreationInputTokens ?? 0).toBeGreaterThan(0);
      // smoltalk takes cache writes out of prompt_tokens. That is right only
      // if OpenRouter counts them inside prompt_tokens, in which case the
      // total covers the writes plus the output.
      expect(firstUsage?.totalTokens ?? 0).toBeGreaterThanOrEqual(
        (firstUsage?.cacheCreationInputTokens ?? 0) + (firstUsage?.outputTokens ?? 0),
      );

      // The second call ends in a tool result, so its breakpoint is on a
      // role: "tool" message.
      const second = await text({
        ...base,
        messages: [
          systemMessage(longSystem),
          userMessage("Use the lookup tool to look up part 7."),
          assistantMessage(null, { toolCalls: [call] }),
          toolMessage("Part 7: a widget of size 7 mm.", {
            tool_call_id: call.id,
            name: call.name,
          }),
        ],
      });
      expect(second.success).toBe(true);
      if (!second.success) return;
      expect(second.value.usage?.cachedInputTokens ?? 0).toBeGreaterThan(0);
    },
  );
});

d("OpenRouter - provider routing", () => {
  it(
    "routes to the provider it was told to and reports it",
    { timeout: 60_000 },
    async () => {
      const r = await text({
        model: "z-ai/glm-5.3-flash",
        provider: "openrouter",
        apiKey: { openRouter: KEY! },
        messages: [userMessage("Say hi.")],
        openRouter: { provider: { only: ["fireworks"], allowFallbacks: false } },
        maxTokens: 2000,
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.value.servedBy).toBe("Fireworks");
      }
    },
  );
});
