import { describe, it, expect } from "vitest";
import { promptResult } from "./types.js";
import type { HostedToolResult } from "./types.js";

describe("promptResult with hostedToolResults", () => {
  it("passes hostedToolResults through", () => {
    const htr: HostedToolResult[] = [
      { tool: "web_search", provider: "anthropic", queries: ["ts 6.0"], callCount: 1, estimatedCost: 0.01 },
    ];
    const r = promptResult({ output: "hi", hostedToolResults: htr });
    expect(r.hostedToolResults).toHaveLength(1);
    expect(r.hostedToolResults?.[0].queries).toEqual(["ts 6.0"]);
  });
});
