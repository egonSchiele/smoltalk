import { describe, it, expect } from "vitest";
import { parseModelDataBlob } from "./modelData.js";

const tool = {
  name: "google_search",
  provider: "google",
  category: "web_search",
  providerToolId: "google_search",
  pricing: {
    unit: "per_call",
    amount: 0.014,
    freeAllowance: "5,000/month (Gemini 3)",
    note: "billed per query",
    perModel: { "gemini-2.5-pro": { amount: 0.035, note: "billed per prompt" } },
  },
};

describe("HostedToolSchema (via parseModelDataBlob)", () => {
  it("accepts a hosted tool with structured pricing + perModel", () => {
    const raw = JSON.stringify({ schemaVersion: 1, generatedAt: "x", models: [], hostedTools: [tool] });
    const result = parseModelDataBlob(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      const t = result.value.hostedTools[0];
      expect(t.category).toBe("web_search");
      expect(t.pricing?.unit).toBe("per_call");
      expect(t.pricing?.perModel?.["gemini-2.5-pro"]?.amount).toBe(0.035);
    }
  });

  it("skips a hosted tool missing required fields but keeps good ones", () => {
    const raw = JSON.stringify({ schemaVersion: 1, generatedAt: "x", models: [], hostedTools: [tool, { provider: "openai" }] });
    const result = parseModelDataBlob(raw);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.hostedTools).toHaveLength(1);
  });
});
