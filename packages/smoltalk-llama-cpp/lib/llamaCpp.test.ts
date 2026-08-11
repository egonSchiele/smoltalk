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

describe("LlamaCPP model classification (no explicit llamaCppModelDir)", () => {
  it("splits a path-shaped model into dir + file", () => {
    const client = new LlamaCPP({ model: "/models/llama-3.gguf", messages: [] });
    expect((client as any).modelDir).toBe("/models");
    expect((client as any).modelFile).toBe("llama-3.gguf");
  });

  it("derives dir '/' for a root-level path", () => {
    const client = new LlamaCPP({ model: "/llama-3.gguf", messages: [] });
    expect((client as any).modelDir).toBe("/");
    expect((client as any).modelFile).toBe("llama-3.gguf");
  });

  it("classifies Windows drive-letter paths as paths, not URIs", () => {
    const client = new LlamaCPP({
      model: "C:\\models\\llama-3.gguf",
      messages: [],
    });
    expect((client as any).modelDir).toBe("C:\\models");
    expect((client as any).modelFile).toBe("llama-3.gguf");
  });

  it("rejects URI-shaped models with a resolveModel pointer", () => {
    expect(
      () => new LlamaCPP({ model: "hf:org/repo/llama-3.gguf", messages: [] }),
    ).toThrow(/local \.gguf path.*resolveModel\(\)/s);
  });

  it("bare filename without metadata still requires llamaCppModelDir", () => {
    expect(
      () => new LlamaCPP({ model: "llama-3.gguf", messages: [] }),
    ).toThrow(/metadata\.llamaCppModelDir is required/);
  });

  it("explicit llamaCppModelDir wins: model is used as-is, no classification", () => {
    const client = new LlamaCPP({
      model: "hf:org/repo/llama-3.gguf",
      messages: [],
      metadata: { llamaCppModelDir: "/explicit" },
    });
    expect((client as any).modelDir).toBe("/explicit");
    expect((client as any).modelFile).toBe("hf:org/repo/llama-3.gguf");
  });
});
