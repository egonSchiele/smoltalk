import { describe, it, expect } from "vitest";
import { openaiResponsesWebSearchEntries, parseOpenAIResponsesHostedTools } from "./openaiResponses.js";

describe("openaiResponsesWebSearchEntries", () => {
  it("emits {type:'web_search'} when requested", () => {
    expect(openaiResponsesWebSearchEntries(["web_search"])).toEqual([{ type: "web_search" }]);
  });
  it("emits nothing otherwise", () => {
    expect(openaiResponsesWebSearchEntries([])).toEqual([]);
  });
});

describe("parseOpenAIResponsesHostedTools", () => {
  it("normalizes web_search_call + url_citation annotations", () => {
    const response = {
      output: [
        { type: "web_search_call", action: { type: "search", query: "ts 6.0" } },
        { type: "message", content: [{ type: "output_text", text: "TS 6.", annotations: [{ type: "url_citation", url: "https://ts.dev/6", title: "TS 6", start_index: 0, end_index: 4 }] }] },
      ],
    };
    const out = parseOpenAIResponsesHostedTools(response, "openai-responses");
    expect(out).toHaveLength(1);
    expect(out[0].queries).toEqual(["ts 6.0"]);
    expect(out[0].callCount).toBe(1);
    expect(out[0].citations?.[0].url).toBe("https://ts.dev/6");
    expect(out[0].sources?.[0].url).toBe("https://ts.dev/6");
    expect(out[0].raw).toBeDefined(); // full provider payload preserved
  });
  it("returns [] with no web search", () => {
    expect(parseOpenAIResponsesHostedTools({ output: [{ type: "message", content: [] }] }, "openai-responses")).toEqual([]);
  });
});
