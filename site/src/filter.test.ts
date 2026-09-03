import { describe, expect, it } from "vitest";
import { collectProviders, filterModels } from "./filter";

type Row = { modelName: string; provider: string; disabled?: boolean };

const rows: Row[] = [
  { modelName: "gpt-5.6-sol", provider: "openai" },
  { modelName: "claude-fable-5-1", provider: "anthropic" },
  { modelName: "gemini-3.8-flash", provider: "google" },
  { modelName: "gpt-4", provider: "openai", disabled: true },
];

const all = { search: "", providers: [], showDeprecated: false };

describe("filterModels", () => {
  it("hides deprecated models by default", () => {
    expect(filterModels(rows, all).map((r) => r.modelName)).toEqual([
      "gpt-5.6-sol",
      "claude-fable-5-1",
      "gemini-3.8-flash",
    ]);
  });

  it("includes deprecated models when asked", () => {
    const result = filterModels(rows, { ...all, showDeprecated: true });
    expect(result).toHaveLength(4);
  });

  it("matches a name substring case-insensitively", () => {
    const result = filterModels(rows, { ...all, search: "FABLE" });
    expect(result.map((r) => r.modelName)).toEqual(["claude-fable-5-1"]);
  });

  it("matches on provider name too, so 'anthropic' finds its models", () => {
    const result = filterModels(rows, { ...all, search: "anthropic" });
    expect(result.map((r) => r.modelName)).toEqual(["claude-fable-5-1"]);
  });

  it("treats an empty provider list as no provider constraint", () => {
    expect(filterModels(rows, { ...all, providers: [] })).toHaveLength(3);
  });

  it("restricts to the selected providers", () => {
    const result = filterModels(rows, { ...all, providers: ["google"] });
    expect(result.map((r) => r.modelName)).toEqual(["gemini-3.8-flash"]);
  });

  it("combines search, provider and the deprecated toggle", () => {
    const result = filterModels(rows, {
      search: "gpt",
      providers: ["openai"],
      showDeprecated: true,
    });
    expect(result.map((r) => r.modelName)).toEqual(["gpt-5.6-sol", "gpt-4"]);
  });

  it("ignores surrounding whitespace in the search", () => {
    expect(filterModels(rows, { ...all, search: "  sol  " })).toHaveLength(1);
  });
});

describe("collectProviders", () => {
  it("returns each provider once, sorted, including deprecated-only ones", () => {
    expect(collectProviders(rows)).toEqual(["anthropic", "google", "openai"]);
  });
});
