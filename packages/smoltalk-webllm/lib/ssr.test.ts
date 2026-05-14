// @vitest-environment node
//
// SSR-safety guarantee: importing `smoltalk-webllm` must not crash in a
// Node environment, even though @mlc-ai/web-llm references browser-only
// globals at module-evaluation time. The dynamic import inside loadModel's
// factory is what makes this work — these tests catch any future regression
// (e.g. someone adding a top-level `import "@mlc-ai/web-llm"`).

import { describe, it, expect, beforeEach } from "vitest";

describe("SSR import safety (Node environment)", () => {
  beforeEach(() => {
    // Simulate Node: no `navigator`.
    delete (globalThis as any).navigator;
  });

  it("the package's public entry can be imported without crashing", async () => {
    const mod = await import("./index.js");
    expect(typeof mod.loadModel).toBe("function");
    expect(typeof mod.unloadModel).toBe("function");
    expect(typeof mod.isLoaded).toBe("function");
    expect(typeof mod.WebLLMClient).toBe("function");
  });

  it("synchronous helpers work without touching @mlc-ai/web-llm", async () => {
    const { isLoaded } = await import("./index.js");
    expect(isLoaded("any-id")).toBe(false);
  });

  it("loadModel rejects with a clear WebGPU error before web-llm is loaded", async () => {
    const { loadModel } = await import("./index.js");
    await expect(loadModel("any-id")).rejects.toThrow(/WebGPU is not available/);
  });
});
