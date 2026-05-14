import { describe, it, expect, vi } from "vitest";

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
