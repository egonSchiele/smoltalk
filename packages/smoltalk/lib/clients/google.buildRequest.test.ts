import { describe, it, expect } from "vitest";
import { SmolGoogle, geminiSupportsToolCirculation } from "./google.js";
import { userMessage } from "../classes/message/index.js";
import { z } from "zod";

function build(model: string, config: any) {
  const client = new SmolGoogle({
    model,
    apiKey: { google: "test-key" },
    messages: [],
  } as any);
  return (client as any).buildRequest({
    model,
    messages: [userMessage("hi")],
    ...config,
  });
}

const addTool = {
  name: "add",
  description: "Adds two integers.",
  schema: z.object({ a: z.number(), b: z.number() }),
};

// Regression for egonSchiele/agency-lang#495. Verified against the live API:
// Gemini 3+ can combine built-in web search with function calling only with
// includeServerSideToolInvocations; Gemini 2.5 and earlier cannot combine them
// at all (both the flag and the raw combination 400).
describe("geminiSupportsToolCirculation", () => {
  it("true for Gemini 3+, false for 2.x, true for unknown", () => {
    expect(geminiSupportsToolCirculation("gemini-3-flash-preview")).toBe(true);
    expect(geminiSupportsToolCirculation("gemini-3-pro-preview")).toBe(true);
    expect(geminiSupportsToolCirculation("gemini-2.5-flash")).toBe(false);
    expect(geminiSupportsToolCirculation("gemini-2.5-pro")).toBe(false);
    expect(geminiSupportsToolCirculation("gemini-2.0-flash")).toBe(false);
    expect(geminiSupportsToolCirculation("some-future-model")).toBe(true);
  });
});

describe("SmolGoogle.buildRequest — web_search + function tools", () => {
  it("sets includeServerSideToolInvocations on Gemini 3+", () => {
    const { config } = build("gemini-3-flash-preview", {
      tools: [addTool],
      hostedTools: ["web_search"],
    });
    expect(config.toolConfig?.includeServerSideToolInvocations).toBe(true);
    const groups = config.tools as any[];
    expect(groups.some((g) => g.functionDeclarations)).toBe(true);
    expect(groups.some((g) => g.googleSearch)).toBe(true);
  });

  it("throws an actionable error on Gemini 2.5 (combination impossible)", () => {
    expect(() =>
      build("gemini-2.5-flash", {
        tools: [addTool],
        hostedTools: ["web_search"],
      }),
    ).toThrow(/cannot use the hosted web_search tool together with function tools/);
  });

  it("does not set toolConfig for function tools alone (any model)", () => {
    const { config } = build("gemini-2.5-flash", {
      tools: [addTool],
    });
    expect(config.toolConfig).toBeUndefined();
  });

  it("does not set toolConfig for web_search alone (any model)", () => {
    const { config } = build("gemini-2.5-flash", {
      hostedTools: ["web_search"],
    });
    expect(config.toolConfig).toBeUndefined();
    expect((config.tools as any[]).some((g) => g.googleSearch)).toBe(true);
  });
});
