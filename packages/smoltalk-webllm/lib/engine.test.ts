import { describe, it, expect, beforeEach } from "vitest";
import {
  getEngine,
  isLoaded,
  unloadModel,
  loadModel,
  __setEngineForTesting,
  __clearEnginesForTesting,
  __setEngineFactoryForTesting,
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

const withGpu = () => {
  (globalThis as any).navigator = { gpu: {} };
};
const withoutGpu = () => {
  (globalThis as any).navigator = {};
};

describe("loadModel", () => {
  beforeEach(() => {
    __clearEnginesForTesting();
    withGpu();
  });

  it("throws SmolError when WebGPU is not available", async () => {
    withoutGpu();
    await expect(
      loadModel("Llama-3.2-1B-Instruct-q4f32_1-MLC"),
    ).rejects.toThrow(/WebGPU is not available/);
  });

  it("invokes the factory with the string model id and stores the engine", async () => {
    const stub = { unload: async () => {} } as any;
    let receivedId: string | null = null;
    __setEngineFactoryForTesting(async (id, _opts) => {
      receivedId = id;
      return stub;
    });
    await loadModel("Llama-3.2-1B-Instruct-q4f32_1-MLC");
    expect(receivedId).toBe("Llama-3.2-1B-Instruct-q4f32_1-MLC");
    expect(isLoaded("Llama-3.2-1B-Instruct-q4f32_1-MLC")).toBe(true);
  });

  it("dedupes concurrent loads of the same model", async () => {
    let calls = 0;
    __setEngineFactoryForTesting(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return { unload: async () => {} } as any;
    });
    await Promise.all([loadModel("a"), loadModel("a"), loadModel("a")]);
    expect(calls).toBe(1);
  });

  it("is a no-op when the model is already loaded", async () => {
    let calls = 0;
    __setEngineFactoryForTesting(async () => {
      calls++;
      return { unload: async () => {} } as any;
    });
    await loadModel("a");
    await loadModel("a");
    expect(calls).toBe(1);
  });

  it("accepts a CustomModel object and uses its id", async () => {
    let received: any = null;
    __setEngineFactoryForTesting(async (id, _opts, custom) => {
      received = { id, custom };
      return { unload: async () => {} } as any;
    });
    await loadModel({
      id: "my-custom",
      modelUrl: "https://x/y",
      modelLibUrl: "https://x/z",
      contextWindow: 4096,
    });
    expect(received.id).toBe("my-custom");
    expect(received.custom.modelUrl).toBe("https://x/y");
    expect(isLoaded("my-custom")).toBe(true);
  });

  it("forwards progress callbacks", async () => {
    const progressSeen: any[] = [];
    __setEngineFactoryForTesting(async (_id, opts) => {
      opts?.onProgress?.({
        stage: "downloading",
        loaded: 50,
        total: 100,
        text: "x",
      });
      return { unload: async () => {} } as any;
    });
    await loadModel("a", { onProgress: (p) => progressSeen.push(p) });
    expect(progressSeen).toHaveLength(1);
    expect(progressSeen[0].stage).toBe("downloading");
    expect(progressSeen[0].loaded).toBe(50);
  });

  it("rejects with abort error when signal fires", async () => {
    let resolveFactory: (e: any) => void = () => {};
    __setEngineFactoryForTesting(
      () =>
        new Promise<any>((resolve) => {
          resolveFactory = resolve;
        }),
    );
    const ctrl = new AbortController();
    const p = loadModel("a", { signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toThrow(/aborted/i);
    // simulate the late-arriving engine; it must NOT end up in the registry
    let unloaded = false;
    resolveFactory({
      unload: async () => {
        unloaded = true;
      },
    });
    // give the late-unload microtask a tick
    await new Promise((r) => setTimeout(r, 0));
    expect(isLoaded("a")).toBe(false);
    expect(unloaded).toBe(true);
  });

  it("does not unload the engine when one waiter aborts but another is still waiting", async () => {
    let resolveFactory: (e: any) => void = () => {};
    let unloaded = false;
    __setEngineFactoryForTesting(
      () =>
        new Promise<any>((resolve) => {
          resolveFactory = resolve;
        }),
    );
    const ctrlA = new AbortController();
    const aborted = loadModel("a", { signal: ctrlA.signal });
    // Caller B has no signal — must always succeed and see the engine.
    const succeeded = loadModel("a");

    ctrlA.abort();
    await expect(aborted).rejects.toThrow(/aborted/i);

    resolveFactory({
      unload: async () => {
        unloaded = true;
      },
    });

    await expect(succeeded).resolves.toBeUndefined();
    expect(isLoaded("a")).toBe(true);
    expect(unloaded).toBe(false);
  });

  it("rejects immediately if signal is already aborted", async () => {
    __setEngineFactoryForTesting(
      async () => ({ unload: async () => {} }) as any,
    );
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(loadModel("a", { signal: ctrl.signal })).rejects.toThrow(
      /aborted/i,
    );
  });
});
