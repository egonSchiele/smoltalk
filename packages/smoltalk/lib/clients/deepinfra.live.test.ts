/**
 * Real-API smoke tests for DeepInfra. Runs only with DEEPINFRA_API_KEY set,
 * via `pnpm test:live`.
 */
import { describe, it, expect } from "vitest";
import { liveProviderSuite } from "./liveTestHelpers.js";
import { embed } from "../embed.js";

// Reuse the shared smoke suite for hello-world/tools/structured/streaming/cost.
liveProviderSuite({
  name: "DeepInfra",
  envKey: "DEEPINFRA_API_KEY",
  provider: "deepinfra",
  // A small, cheap, broadly-available DeepInfra-hosted model.
  model: "meta-llama/Meta-Llama-3.1-8B-Instruct",
});

const KEY = process.env.DEEPINFRA_API_KEY;
const d = KEY ? describe : describe.skip;

d("DeepInfra - embeddings", () => {
  it(
    "returns vectors via openaiCompatEmbed",
    { timeout: 60_000 },
    async () => {
      const r = await embed("hello world", {
        model: "BAAI/bge-small-en-v1.5",
        provider: "deepinfra",
        apiKey: { deepInfra: KEY! },
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.value.embeddings).toHaveLength(1);
        expect(r.value.embeddings[0].length).toBeGreaterThan(0);
      }
    },
  );
});
