/**
 * Real-API smoke tests for the Anthropic provider.
 * Runs only with ANTHROPIC_API_KEY set, via `pnpm test:live`.
 */
import { describe, it, expect } from "vitest";
import { liveProviderSuite } from "./liveTestHelpers.js";
import { text } from "../functions.js";
import {
  SystemMessage,
  userMessage,
} from "../classes/message/index.js";

liveProviderSuite({
  name: "Anthropic",
  envKey: "ANTHROPIC_API_KEY",
  model: "claude-haiku-4-5-20251001",
  thinkingModel: "claude-sonnet-4-6",
});

const haveKey = Boolean(process.env.ANTHROPIC_API_KEY);

describe.runIf(haveKey).concurrent("Anthropic - prompt caching", () => {
  it(
    "writes a cache on first call and reads it on second call",
    { timeout: 60_000 },
    async () => {
      // ~2400 tokens, safely above the 2048 Haiku minimum.
      const longSystem = "You are a helpful assistant. ".repeat(400);

      const r1 = await text({
        model: "claude-haiku-4-5-20251001",
        messages: [new SystemMessage(longSystem), userMessage("hi")],
      });
      expect(r1.success).toBe(true);
      if (!r1.success) throw new Error("first call failed");
      expect(r1.value.usage?.cacheCreationInputTokens ?? 0).toBeGreaterThan(0);

      const r2 = await text({
        model: "claude-haiku-4-5-20251001",
        messages: [new SystemMessage(longSystem), userMessage("again")],
      });
      expect(r2.success).toBe(true);
      if (!r2.success) throw new Error("second call failed");
      expect(r2.value.usage?.cachedInputTokens ?? 0).toBeGreaterThan(0);
    },
  );
});
