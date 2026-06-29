import { describe, it, expect } from "vitest";
import { anthropicWebSearchEntries, parseAnthropicHostedTools } from "./anthropic.js";

describe("anthropicWebSearchEntries", () => {
  it("emits the native web_search tool when requested", () => {
    expect(anthropicWebSearchEntries(["web_search"])).toEqual([
      { type: "web_search_20250305", name: "web_search" },
    ]);
  });
  it("emits nothing when not requested", () => {
    expect(anthropicWebSearchEntries(undefined)).toEqual([]);
    expect(anthropicWebSearchEntries([])).toEqual([]);
  });
});

describe("parseAnthropicHostedTools", () => {
  it("normalizes server_tool_use + web_search_tool_result + citations + count", () => {
    const response = {
      content: [
        { type: "server_tool_use", name: "web_search", input: { query: "ts 6.0" } },
        { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://ts.dev/6", title: "TS 6" }] },
        { type: "text", text: "TS 6 shipped.", citations: [{ url: "https://ts.dev/6", title: "TS 6" }] },
      ],
      usage: { server_tool_use: { web_search_requests: 1 } },
    };
    const out = parseAnthropicHostedTools(response, "anthropic");
    expect(out).toHaveLength(1);
    expect(out[0].tool).toBe("web_search");
    expect(out[0].queries).toEqual(["ts 6.0"]);
    expect(out[0].sources?.[0].url).toBe("https://ts.dev/6");
    expect(out[0].citations?.[0].url).toBe("https://ts.dev/6");
    expect(out[0].callCount).toBe(1);
  });
  it("returns [] when no web search happened", () => {
    expect(parseAnthropicHostedTools({ content: [{ type: "text", text: "hi" }], usage: {} }, "anthropic")).toEqual([]);
  });
});
