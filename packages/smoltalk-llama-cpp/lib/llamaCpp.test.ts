import { describe, it, expect } from "vitest";
import { LlamaCPP } from "./llamaCpp.js";

describe("LlamaCPP constructor", () => {
  it("throws when metadata is missing", () => {
    expect(
      () =>
        new LlamaCPP({
          model: "any-model",
          messages: [],
        }),
    ).toThrow(/metadata\.llamaCppModelDir is required/);
  });

  it("throws when metadata.llamaCppModelDir is missing", () => {
    expect(
      () =>
        new LlamaCPP({
          model: "any-model",
          messages: [],
          metadata: {},
        }),
    ).toThrow(/metadata\.llamaCppModelDir is required/);
  });

  it("constructs successfully when metadata.llamaCppModelDir is provided", () => {
    const client = new LlamaCPP({
      model: "any-model",
      messages: [],
      metadata: { llamaCppModelDir: "./does-not-need-to-exist" },
    });
    expect(client).toBeInstanceOf(LlamaCPP);
  });

  it("error message points users at the metadata key", () => {
    expect(
      () => new LlamaCPP({ model: "any", messages: [], metadata: {} }),
    ).toThrow(/smoltalk-llama-cpp.*metadata\.llamaCppModelDir/s);
  });
});
