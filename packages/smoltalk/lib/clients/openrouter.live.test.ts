/**
 * Real-API smoke tests for OpenRouter. Runs only with OPENROUTER_API_KEY set,
 * via `pnpm test:live`.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { text, textStream } from "../functions.js";
import { userMessage } from "../classes/message/index.js";
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
