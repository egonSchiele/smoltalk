import { describe, it, expect } from "vitest";
import { getModel } from "./models.js";

// Rule: provider "openai-responses" is reserved for models that are ONLY
// available via the Responses API (the *-pro reasoning models). Every other
// OpenAI model — including the base GPT-5 family, which works on both APIs —
// uses Chat Completions ("openai").

const RESPONSES_ONLY = [
  "o3-pro",
  "gpt-5-pro",
  "gpt-5.2-pro",
  "gpt-5.4-pro",
  "gpt-5.5-pro",
];

const CHAT_COMPLETIONS = [
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-5.1",
  "gpt-5.2",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.5",
  "o3",
  "o3-mini",
  "o4-mini",
  "o1",
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4.1",
];

describe("OpenAI provider routing", () => {
  it("routes Responses-only models to openai-responses", () => {
    for (const name of RESPONSES_ONLY) {
      expect(getModel(name)?.provider, name).toBe("openai-responses");
    }
  });

  it("routes dual-API OpenAI models to openai (Chat Completions)", () => {
    for (const name of CHAT_COMPLETIONS) {
      expect(getModel(name)?.provider, name).toBe("openai");
    }
  });
});
