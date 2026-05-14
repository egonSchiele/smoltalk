import { describe, it, expect, vi, beforeEach } from "vitest";

describe("listModels", () => {
  it("returns the model ids from web-llm's prebuiltAppConfig", async () => {
    vi.doMock("@mlc-ai/web-llm", () => ({
      prebuiltAppConfig: {
        model_list: [
          { model_id: "Llama-3.2-1B-Instruct-q4f32_1-MLC" },
          { model_id: "Phi-3.5-mini-instruct-q4f32_1-MLC" },
        ],
      },
    }));
    const { listModels } = await import("./engine.js");
    const ids = await listModels();
    expect(ids).toContain("Llama-3.2-1B-Instruct-q4f32_1-MLC");
    expect(ids).toContain("Phi-3.5-mini-instruct-q4f32_1-MLC");
  });
});

describe("defaultFactory — CustomModel forwarding", () => {
  beforeEach(() => {
    (globalThis as any).navigator = { gpu: {} };
  });

  it("forwards contextWindow and maxOutputTokens via overrides", async () => {
    let receivedConfig: any = null;
    vi.resetModules();
    vi.doMock("@mlc-ai/web-llm", () => ({
      prebuiltAppConfig: { model_list: [] },
      CreateMLCEngine: async (_id: string, config: any) => {
        receivedConfig = config;
        return { unload: async () => {} } as any;
      },
    }));
    const { loadModel, __clearEnginesForTesting } = await import("./engine.js");
    __clearEnginesForTesting();
    await loadModel({
      id: "my-model",
      modelUrl: "https://example.com/model",
      modelLibUrl: "https://example.com/model.wasm",
      contextWindow: 2048,
      maxOutputTokens: 512,
    });
    const entry = receivedConfig.appConfig.model_list[0];
    expect(entry.model).toBe("https://example.com/model");
    expect(entry.model_id).toBe("my-model");
    expect(entry.model_lib).toBe("https://example.com/model.wasm");
    expect(entry.overrides).toEqual({
      context_window_size: 2048,
      max_tokens: 512,
    });
  });

  it("omits overrides.max_tokens when maxOutputTokens is undefined", async () => {
    let receivedConfig: any = null;
    vi.resetModules();
    vi.doMock("@mlc-ai/web-llm", () => ({
      prebuiltAppConfig: { model_list: [] },
      CreateMLCEngine: async (_id: string, config: any) => {
        receivedConfig = config;
        return { unload: async () => {} } as any;
      },
    }));
    const { loadModel, __clearEnginesForTesting } = await import("./engine.js");
    __clearEnginesForTesting();
    await loadModel({
      id: "my-model-2",
      modelUrl: "https://example.com/m",
      modelLibUrl: "https://example.com/m.wasm",
      contextWindow: 4096,
    });
    const entry = receivedConfig.appConfig.model_list[0];
    expect(entry.overrides).toEqual({ context_window_size: 4096 });
  });
});
