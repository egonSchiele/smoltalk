/**
 * Real-API smoke tests for the OpenAI Responses provider.
 * Runs only with OPENAI_API_KEY set, via `pnpm test:live`.
 */
import { liveProviderSuite } from "./liveTestHelpers.js";

liveProviderSuite({
  name: "OpenAI Responses",
  envKey: "OPENAI_API_KEY",
  model: "gpt-4o-mini",
  provider: "openai-responses",
  strictResponseFormat: true,
});
