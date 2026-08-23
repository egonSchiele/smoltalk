import { describe, it, expect } from "vitest";
import { getModel, modelSupportsInputModality } from "./models.js";

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

describe("modelSupportsInputModality with an API-variant provider", () => {
  it("falls back to the name-keyed entry when the provider key misses", () => {
    // gpt-5-mini is cataloged under "openai"; asking with the API-variant
    // provider "openai-responses" must not lose the modality data.
    expect(
      modelSupportsInputModality("gpt-5-mini", "image", undefined, "openai-responses"),
    ).toBe(true);
  });

  it("still resolves a provider-keyed entry when one exists", () => {
    expect(
      modelSupportsInputModality("o3-pro", "image", undefined, "openai-responses"),
    ).toBe(true);
  });
});
