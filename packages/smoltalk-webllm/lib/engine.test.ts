import { describe, it, expect, beforeEach } from "vitest";
import {
  getEngine,
  isLoaded,
  unloadModel,
  __setEngineForTesting,
  __clearEnginesForTesting,
} from "./engine.js";

describe("engine registry", () => {
  beforeEach(() => __clearEnginesForTesting());

  it("isLoaded returns false when no engine is registered", () => {
    expect(isLoaded("foo")).toBe(false);
  });

  it("getEngine throws a helpful error when no engine is loaded", () => {
    expect(() => getEngine("foo")).toThrow(
      /Model not loaded: call loadModel\("foo"\) first/,
    );
  });

  it("isLoaded and getEngine return the registered engine", () => {
    const fake = { id: "stub" } as any;
    __setEngineForTesting("foo", fake);
    expect(isLoaded("foo")).toBe(true);
    expect(getEngine("foo")).toBe(fake);
  });
});

describe("unloadModel", () => {
  beforeEach(() => __clearEnginesForTesting());

  it("calls engine.unload() and removes it from the registry", async () => {
    let unloaded = false;
    const fake = {
      unload: async () => {
        unloaded = true;
      },
    } as any;
    __setEngineForTesting("a", fake);
    await unloadModel("a");
    expect(unloaded).toBe(true);
    expect(isLoaded("a")).toBe(false);
  });

  it("is a no-op when the model is not loaded", async () => {
    await expect(unloadModel("nope")).resolves.toBeUndefined();
  });
});
