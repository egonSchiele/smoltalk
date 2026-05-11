/**
 * Real-API smoke tests for the Google Gemini provider.
 * Runs only with GEMINI_API_KEY set, via `pnpm test:live`.
 */
import { liveProviderSuite } from "./liveTestHelpers.js";

liveProviderSuite({
  name: "Google",
  envKey: "GEMINI_API_KEY",
  model: "gemini-2.5-flash-lite",
  thinkingModel: "gemini-3-flash-preview",
});
