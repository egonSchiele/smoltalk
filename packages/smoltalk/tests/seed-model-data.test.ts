import { describe, it, expect } from "vitest";
import { buildSeedBlob } from "../scripts/seed-model-data.js";

describe("buildSeedBlob", () => {
  it("produces a valid blob carrying baseline models and hosted tools", () => {
    const blob = buildSeedBlob("2026-06-28T00:00:00Z");
    expect(blob.schemaVersion).toBe(1);
    expect(blob.generatedAt).toBe("2026-06-28T00:00:00Z");
    expect(blob.models.find((m) => m.modelName === "claude-opus-4-8")).toBeTruthy();
    expect(blob.hostedTools.find((t) => t.name === "web_search")).toBeTruthy();
  });
});
