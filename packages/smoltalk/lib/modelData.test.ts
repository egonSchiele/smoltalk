import { describe, it, expect } from "vitest";
import { parseModelDataBlob, SUPPORTED_SCHEMA_VERSION } from "./modelData.js";

describe("parseModelDataBlob", () => {
  const validModel = {
    type: "text",
    modelName: "test-model",
    provider: "openai",
    maxInputTokens: 1000,
    maxOutputTokens: 100,
    inputTokenCost: 1,
    outputTokenCost: 2,
  };

  it("accepts a well-formed blob", () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      generatedAt: "2026-06-28T00:00:00Z",
      models: [validModel],
      hostedTools: [{ name: "web_search", provider: "anthropic", costPerCall: 0.01 }],
    });
    const result = parseModelDataBlob(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.models).toHaveLength(1);
      expect(result.value.hostedTools[0].name).toBe("web_search");
    }
  });

  it("fails on non-JSON", () => {
    const result = parseModelDataBlob("not json {");
    expect(result.success).toBe(false);
  });

  it("fails when schemaVersion is newer than supported", () => {
    const raw = JSON.stringify({
      schemaVersion: SUPPORTED_SCHEMA_VERSION + 1,
      generatedAt: "2026-06-28T00:00:00Z",
      models: [],
    });
    const result = parseModelDataBlob(raw);
    expect(result.success).toBe(false);
  });

  it("fails when models is not an array", () => {
    const raw = JSON.stringify({ schemaVersion: 1, generatedAt: "x", models: {} });
    expect(parseModelDataBlob(raw).success).toBe(false);
  });

  it("skips a bad model entry but keeps good ones", () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      generatedAt: "x",
      models: [validModel, { provider: "openai" }],
    });
    const result = parseModelDataBlob(raw);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.models).toHaveLength(1);
  });

  it("defaults hostedTools to an empty array when absent", () => {
    const raw = JSON.stringify({ schemaVersion: 1, generatedAt: "x", models: [] });
    const result = parseModelDataBlob(raw);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.hostedTools).toEqual([]);
  });
});
