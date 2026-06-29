import { describe, it, expect } from "vitest";
import { googleWebSearchEntries, parseGoogleHostedTools } from "./google.js";

describe("googleWebSearchEntries", () => {
  it("emits {googleSearch:{}} when requested", () => {
    expect(googleWebSearchEntries(["web_search"])).toEqual([{ googleSearch: {} }]);
  });
  it("emits nothing otherwise", () => {
    expect(googleWebSearchEntries(undefined)).toEqual([]);
  });
});

describe("parseGoogleHostedTools", () => {
  const result = {
    candidates: [
      {
        groundingMetadata: {
          webSearchQueries: ["ts 6.0", "typescript 6"],
          groundingChunks: [{ web: { uri: "https://ts.dev/6", title: "TS 6" } }],
          groundingSupports: [{ segment: { startIndex: 0, endIndex: 4 }, groundingChunkIndices: [0] }],
        },
      },
    ],
  };
  it("normalizes queries/sources/citations; callCount = #queries on gemini 3", () => {
    const out = parseGoogleHostedTools(result, "google", "gemini-3-pro-preview");
    expect(out[0].queries).toEqual(["ts 6.0", "typescript 6"]);
    expect(out[0].sources?.[0].url).toBe("https://ts.dev/6");
    expect(out[0].citations?.[0].url).toBe("https://ts.dev/6");
    expect(out[0].callCount).toBe(2);
    expect(out[0].raw).toBeDefined(); // full grounding payload preserved
  });
  it("callCount = 1 on gemini 2.5 (billed per prompt)", () => {
    const out = parseGoogleHostedTools(result, "google", "gemini-2.5-flash");
    expect(out[0].callCount).toBe(1);
  });
  it("degrades gracefully when groundingChunks is missing", () => {
    const r = { candidates: [{ groundingMetadata: { webSearchQueries: ["x"] } }] };
    const out = parseGoogleHostedTools(r, "google", "gemini-3-pro-preview");
    expect(out[0].queries).toEqual(["x"]);
    expect(out[0].sources).toBeUndefined();
  });
  it("returns [] without grounding", () => {
    expect(parseGoogleHostedTools({ candidates: [{}] }, "google", "gemini-3-pro-preview")).toEqual([]);
  });
});
