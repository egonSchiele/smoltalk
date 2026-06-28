import { describe, it, expect } from "vitest";
import { deepMergeEntry, mergeModelData, mergeHostedTools } from "./modelData.js";
import type { ModelType } from "./models.js";

describe("deepMergeEntry", () => {
  it("overlay field wins", () => {
    expect(deepMergeEntry({ a: 1, b: 2 }, { b: 3 })).toEqual({ a: 1, b: 3 });
  });
  it("undefined overlay field does not clobber", () => {
    expect(deepMergeEntry({ a: 1 }, { a: undefined })).toEqual({ a: 1 });
  });
  it("merges nested plain objects", () => {
    const out = deepMergeEntry({ r: { x: 1, y: 2 } }, { r: { y: 9 } });
    expect(out).toEqual({ r: { x: 1, y: 9 } });
  });
});

describe("mergeModelData", () => {
  const base: ModelType[] = [
    { type: "text", modelName: "m1", provider: "openai", maxInputTokens: 1, maxOutputTokens: 1, inputTokenCost: 1, outputTokenCost: 2 },
  ];

  it("overlays corrected pricing onto an existing model, keeping other fields", () => {
    const overlay = [{ type: "text", modelName: "m1", provider: "openai", inputTokenCost: 99 }] as unknown as ModelType[];
    const out = mergeModelData(base, overlay);
    expect(out).toHaveLength(1);
    expect(out[0].inputTokenCost).toBe(99);
    expect((out[0] as any).maxInputTokens).toBe(1);
  });

  it("adds a brand-new model", () => {
    const overlay = [{ type: "text", modelName: "m2", provider: "openai", inputTokenCost: 5 }] as unknown as ModelType[];
    const out = mergeModelData(base, overlay);
    expect(out.map((m) => m.modelName)).toEqual(["m1", "m2"]);
  });

  it("treats same name + different provider as distinct entries", () => {
    const overlay = [{ type: "text", modelName: "m1", provider: "google", inputTokenCost: 7 }] as unknown as ModelType[];
    const out = mergeModelData(base, overlay);
    expect(out).toHaveLength(2);
  });
});

describe("mergeHostedTools", () => {
  it("overlays a tool by provider+name and adds new ones", () => {
    const base = [{ name: "web_search", provider: "anthropic", costPerCall: 0.01 }];
    const overlay = [
      { name: "web_search", provider: "anthropic", costPerCall: 0.02 },
      { name: "code_exec", provider: "anthropic", costPerCall: 0.05 },
    ];
    const out = mergeHostedTools(base, overlay);
    expect(out).toHaveLength(2);
    expect(out[0].costPerCall).toBe(0.02);
  });
});
