import { describe, it, expect } from "vitest";
import { ToolCall } from "./ToolCall.js";

describe("ToolCall", () => {
  describe("constructor", () => {
    it("accepts an object as arguments", () => {
      const tc = new ToolCall("id-1", "get_weather", { city: "London" });
      expect(tc.id).toBe("id-1");
      expect(tc.name).toBe("get_weather");
      expect(tc.arguments).toEqual({ city: "London" });
    });

    it("parses a JSON string as arguments", () => {
      const tc = new ToolCall(
        "id-2",
        "get_weather",
        '{"city":"Paris"}',
      );
      expect(tc.arguments).toEqual({ city: "Paris" });
    });

    it("falls back to empty object on invalid JSON string", () => {
      const tc = new ToolCall("id-3", "broken", "not valid json{");
      expect(tc.arguments).toEqual({});
    });

    it("handles empty object arguments", () => {
      const tc = new ToolCall("id-4", "no_args", {});
      expect(tc.arguments).toEqual({});
    });

    it("handles nested object arguments", () => {
      const args = { user: { name: "Alice", scores: [1, 2, 3] } };
      const tc = new ToolCall("id-5", "complex", args);
      expect(tc.arguments).toEqual(args);
    });
  });

  describe("toJSON / fromJSON round-trip", () => {
    it("round-trips a simple tool call", () => {
      const original = new ToolCall("id-1", "add", { a: 1, b: 2 });
      const json = original.toJSON();
      const restored = ToolCall.fromJSON(json);
      expect(restored.id).toBe(original.id);
      expect(restored.name).toBe(original.name);
      expect(restored.arguments).toEqual(original.arguments);
    });

    it("toJSON returns a plain object", () => {
      const tc = new ToolCall("id-1", "test", { x: 10 });
      const json = tc.toJSON();
      expect(json).toEqual({
        id: "id-1",
        name: "test",
        arguments: { x: 10 },
      });
    });

    it("round-trips with empty arguments", () => {
      const original = new ToolCall("id-1", "noop", {});
      const restored = ToolCall.fromJSON(original.toJSON());
      expect(restored.arguments).toEqual({});
    });
  });

  describe("toOpenAI", () => {
    it("returns the OpenAI tool call format", () => {
      const tc = new ToolCall("call-1", "get_weather", { city: "NYC" });
      const openai = tc.toOpenAI();
      expect(openai.id).toBe("call-1");
      expect(openai.type).toBe("function");
      expect(openai.function.name).toBe("get_weather");
      expect(openai.function.arguments).toBe('{"city":"NYC"}');
      expect(typeof openai.function.arguments).toBe("string");
    });
  });

  describe("toGoogle", () => {
    it("returns the Google function call format", () => {
      const tc = new ToolCall("call-1", "get_weather", { city: "NYC" });
      const google = tc.toGoogle();
      expect(google.functionCall).toBeDefined();
      expect(google.functionCall.name).toBe("get_weather");
      expect(google.functionCall.args).toEqual({ city: "NYC" });
      expect(typeof google.functionCall.args).toBe("object");
    });

    // Change 2b: id-based pairing is symmetric — Gemini needs functionCall.id in
    // the replayed model turn to match the functionResponse.id it gets back.
    it("emits functionCall.id when the id is set", () => {
      const tc = new ToolCall("call-1", "get_weather", { city: "NYC" });
      expect(tc.toGoogle().functionCall.id).toBe("call-1");
    });

    // Never send an empty id: Gemini 3 issues none and rejects/ignores it.
    it("omits functionCall.id when the id is empty", () => {
      const tc = new ToolCall("", "get_weather", { city: "NYC" });
      expect("id" in tc.toGoogle().functionCall).toBe(false);
    });
  });

  describe("toOpenAIResponseInputItem", () => {
    it("returns the OpenAI Responses API format", () => {
      const tc = new ToolCall("call-1", "get_weather", { city: "NYC" });
      const item = tc.toOpenAIResponseInputItem() as any;
      expect(item.type).toBe("function_call");
      expect(item.call_id).toBe("call-1");
      expect(item.name).toBe("get_weather");
      expect(item.arguments).toBe('{"city":"NYC"}');
    });
  });
});
