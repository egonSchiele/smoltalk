/**
 * Real-API smoke tests for the Anthropic provider.
 * Runs only with ANTHROPIC_API_KEY set, via `pnpm test:live`.
 */
import { liveProviderSuite } from "./liveTestHelpers.js";

liveProviderSuite({
  name: "Anthropic",
  envKey: "ANTHROPIC_API_KEY",
  model: "claude-haiku-4-5-20251001",
  thinkingModel: "claude-sonnet-4-6",
});
