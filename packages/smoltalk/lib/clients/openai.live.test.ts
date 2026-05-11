/**
 * Real-API smoke tests for the OpenAI Chat Completions provider.
 * Runs only with OPENAI_API_KEY set, via `pnpm test:live`.
 */
import { liveProviderSuite } from "./liveTestHelpers.js";

liveProviderSuite({
  name: "OpenAI (Chat Completions)",
  envKey: "OPENAI_API_KEY",
  model: "gpt-4o-mini",
  strictResponseFormat: true,
});
