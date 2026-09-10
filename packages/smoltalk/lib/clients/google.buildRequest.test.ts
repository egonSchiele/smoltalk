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

describe("SmolGoogle.buildRequest — thinking config", () => {
  it("requests thought summaries (includeThoughts) when thinking is enabled", () => {
    const req = build("gemini-3-flash-preview", {
      thinking: { enabled: true, budgetTokens: 2000 },
    });
    expect(req.config.thinkingConfig?.includeThoughts).toBe(true);
    expect(req.config.thinkingConfig?.thinkingBudget).toBe(2000);
  });

  it("enables includeThoughts even without an explicit budget", () => {
    const req = build("gemini-3-flash-preview", { thinking: { enabled: true } });
    expect(req.config.thinkingConfig?.includeThoughts).toBe(true);
    expect(req.config.thinkingConfig?.thinkingBudget).toBeUndefined();
  });

  it("maps reasoningEffort to a budget without includeThoughts when thinking is off", () => {
    const req = build("gemini-3-flash-preview", { reasoningEffort: "medium" });
    expect(req.config.thinkingConfig?.thinkingBudget).toBe(8192);
    expect(req.config.thinkingConfig?.includeThoughts).toBeUndefined();
  });

  it("sets no thinkingConfig when neither thinking nor reasoningEffort is set", () => {
    const req = build("gemini-3-flash-preview", {});
    expect(req.config.thinkingConfig).toBeUndefined();
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

// Gemini's responseJsonSchema silently ignores `const` (verified live on
// gemini-3.5-flash-lite: a union of literals came back as free prose), but it
// honours `enum`. Zod emits `anyOf: [{type:"string", const:"a"}, ...]` for a
// union of literals, so the Google client must rewrite `const` to `enum` and
// collapse a same-typed anyOf-of-enums into one enum before sending.
describe("SmolGoogle.buildRequest — responseFormat literal unions", () => {
  it("rewrites a zod literal union to a single string enum", () => {
    const Mood = z.union([z.literal("idle"), z.literal("happy"), z.literal("sad")]);
    const req = build("gemini-3.5-flash-lite", {
      responseFormat: z.object({ response: Mood }),
    });
    expect(req.config.responseMimeType).toBe("application/json");
    const schema = req.config.responseJsonSchema as any;
    expect(schema.properties.response).toEqual({
      type: "string",
      enum: ["idle", "happy", "sad"],
    });
  });

  it("rewrites a lone literal to a one-value enum", () => {
    const req = build("gemini-3.5-flash-lite", {
      responseFormat: z.object({ kind: z.literal("expression") }),
    });
    const schema = req.config.responseJsonSchema as any;
    expect(schema.properties.kind).toEqual({ type: "string", enum: ["expression"] });
  });

  it("keeps a mixed-type anyOf as anyOf but still rewrites each const", () => {
    const req = build("gemini-3.5-flash-lite", {
      responseFormat: z.object({ v: z.union([z.literal("a"), z.literal(1)]) }),
    });
    const schema = req.config.responseJsonSchema as any;
    expect(schema.properties.v.anyOf).toEqual([
      { type: "string", enum: ["a"] },
      { type: "number", enum: [1] },
    ]);
  });
});
