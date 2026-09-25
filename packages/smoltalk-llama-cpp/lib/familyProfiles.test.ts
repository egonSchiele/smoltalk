import { describe, it, expect, vi } from "vitest";

// The profiles only need node-llama-cpp for the wrapper classes and the
// text helpers, none of which need a native build.
vi.mock("node-llama-cpp", () => {
  class ChatWrapper {}
  class QwenChatWrapper extends ChatWrapper {}
  class DeepSeekChatWrapper extends ChatWrapper {}
  class SeedChatWrapper extends ChatWrapper {}
  class Gemma4ChatWrapper extends ChatWrapper {}
  class HarmonyChatWrapper extends ChatWrapper {}
  class SpecialTokensText {
    constructor(public text: string) {}
  }
  const LlamaText = (...parts: any[]) => ({
    toString: () => parts.map((p) => (typeof p === "string" ? p : p.text)).join(""),
  });
  return {
    QwenChatWrapper,
    DeepSeekChatWrapper,
    SeedChatWrapper,
    Gemma4ChatWrapper,
    HarmonyChatWrapper,
    SpecialTokensText,
    LlamaText,
  };
});

import { DEFAULT_PROFILE, layoutOfWrapper, profileFor, type ThinkingChoice } from "./familyProfiles.js";
import { Gemma4ChatWrapper, HarmonyChatWrapper, QwenChatWrapper } from "node-llama-cpp";

const off: ThinkingChoice = { on: false, off: true, budget: undefined, effort: undefined };
const on: ThinkingChoice = { on: true, off: false, budget: 2048, effort: undefined };
const unsaid: ThinkingChoice = { on: false, off: false, budget: undefined, effort: undefined };
const effortOnly: ThinkingChoice = { on: false, off: false, budget: 8192, effort: "medium" };

describe("profileFor", () => {
  it("gives a known architecture its family's settings alone", () => {
    expect(profileFor("qwen35").thinkingSettings(off)).toEqual({ qwen: { thoughts: "discourage" } });
    expect(profileFor("gemma4").thinkingSettings(on)).toEqual({ gemma4: { reasoning: true } });
    expect(profileFor("gpt-oss").thinkingSettings(off)).toEqual({ harmony: { reasoningEffort: "low" } });
    expect(profileFor("gpt-oss").thinkingSettings(effortOnly)).toEqual({ harmony: { reasoningEffort: "medium" } });
  });

  it("leaves the wrapper alone when the call said nothing", () => {
    for (const architecture of ["qwen3", "qwen35", "gemma4", "gpt-oss", "llama", undefined]) {
      expect(profileFor(architecture).thinkingSettings(unsaid), architecture).toBeUndefined();
    }
  });

  it("tells every wrapper about the choice for a family with no profile", () => {
    const profile = profileFor("llama");
    expect(profile).toBe(DEFAULT_PROFILE);
    expect(profile.thinkingSettings(off)).toEqual({
      qwen: { thoughts: "discourage" },
      gemma4: { reasoning: false },
      seed: { thinkingBudget: 0 },
      harmony: { reasoningEffort: "low" },
    });
    expect(profile.thinkingSettings(on)).toEqual({
      qwen: { thoughts: "auto" },
      gemma4: { reasoning: true },
      seed: { thinkingBudget: 2048 },
    });
    expect(profile.replyLayout).toBe("byWrapper");
  });

  it("marks the family whose draft predictor hangs when sampled", () => {
    expect(profileFor("qwen35").draftSamplesSafely).toBe(false);
    expect(profileFor("qwen3").draftSamplesSafely).toBe(true);
    expect(profileFor(undefined).draftSamplesSafely).toBe(true);
  });

  it("gives Gemma 4 the tool markers from its own template", () => {
    expect(profileFor("gemma4").toolMarkers?.wrapper()).toBe(Gemma4ChatWrapper);
    const markers = profileFor("gemma4").toolMarkers?.settings();
    expect(markers?.call.prefix.toString()).toBe("<|tool_call>call:");
    expect(markers?.call.paramsPrefix).toBe("");
    expect(markers?.call.suffix.toString()).toBe("<tool_call|>");
    expect(markers?.result.prefix.toString()).toBe("<|tool_response>response:{{functionName}}{value:");
    expect(markers?.result.suffix.toString()).toBe("}<tool_response|>");
    expect(profileFor("qwen35").toolMarkers).toBeUndefined();
  });

  it("knows which layout each family writes", () => {
    expect(profileFor("qwen35").replyLayout).toBe("blockThenAnswer");
    expect(profileFor("gemma4").replyLayout).toBe("blockThenAnswer");
    expect(profileFor("gpt-oss").replyLayout).toBe("channels");
  });
});

describe("layoutOfWrapper", () => {
  it("reads the layout off the wrapper class for a family with no profile", () => {
    expect(layoutOfWrapper(new QwenChatWrapper() as any)).toBe("blockThenAnswer");
    expect(layoutOfWrapper(new Gemma4ChatWrapper() as any)).toBe("blockThenAnswer");
    expect(layoutOfWrapper(new HarmonyChatWrapper() as any)).toBe("channels");
  });
});
