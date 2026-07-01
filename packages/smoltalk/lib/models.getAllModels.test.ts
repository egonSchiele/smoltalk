import { describe, it, expect, afterEach } from "vitest";
import {
  getAllModels,
  getModel,
  registerModelData,
  clearModelData,
} from "./models.js";
import type { ModelDataBlob } from "./modelData.js";

afterEach(() => clearModelData());

describe("getAllModels", () => {
  it("returns the baked-in catalog", () => {
    const all = getAllModels();
    expect(all.length).toBeGreaterThan(0);
    expect(all.some((m) => m.modelName === "gpt-4o-mini")).toBe(true);
  });

  it("is consistent with getModel", () => {
    const fromList = getAllModels().find((m) => m.modelName === "gpt-4o-mini");
    expect(getModel("gpt-4o-mini")).toEqual(fromList);
  });

  it("includes registered (refreshed) models", () => {
    const blob: ModelDataBlob = {
      schemaVersion: 1,
      generatedAt: "x",
      models: [
        { type: "text", modelName: "brand-new-llm", provider: "anthropic" } as any,
      ],
      hostedTools: [],
    };
    registerModelData(blob);
    expect(getAllModels().some((m) => m.modelName === "brand-new-llm")).toBe(true);
  });

  it("merges optional per-request model data without registering it globally", () => {
    const blob: ModelDataBlob = {
      schemaVersion: 1,
      generatedAt: "x",
      models: [
        { type: "text", modelName: "request-only-llm", provider: "google" } as any,
      ],
      hostedTools: [],
    };
    expect(getAllModels().some((m) => m.modelName === "request-only-llm")).toBe(false);
    expect(getAllModels(blob).some((m) => m.modelName === "request-only-llm")).toBe(true);
    // still not global
    expect(getAllModels().some((m) => m.modelName === "request-only-llm")).toBe(false);
  });
});
