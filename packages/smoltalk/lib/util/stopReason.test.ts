import { describe, it, expect } from "vitest";
import {
  normalizeOpenAIStopReason,
  normalizeAnthropicStopReason,
  normalizeGoogleStopReason,
  normalizeOllamaStopReason,
  normalizeOpenAIResponsesStopReason,
} from "./stopReason.js";

describe("normalizeOpenAIStopReason", () => {
  it("maps the OpenAI finish_reason vocabulary", () => {
    expect(normalizeOpenAIStopReason("stop")).toBe("stop");
    expect(normalizeOpenAIStopReason("length")).toBe("length");
    expect(normalizeOpenAIStopReason("tool_calls")).toBe("tool_use");
    expect(normalizeOpenAIStopReason("function_call")).toBe("tool_use");
    expect(normalizeOpenAIStopReason("content_filter")).toBe("content_filter");
  });

  it("falls back to other for unknown/missing", () => {
    expect(normalizeOpenAIStopReason("weird")).toBe("other");
    expect(normalizeOpenAIStopReason(null)).toBe("other");
    expect(normalizeOpenAIStopReason(undefined)).toBe("other");
  });
});

describe("normalizeAnthropicStopReason", () => {
  it("maps the Anthropic stop_reason vocabulary", () => {
    expect(normalizeAnthropicStopReason("end_turn")).toBe("stop");
    expect(normalizeAnthropicStopReason("max_tokens")).toBe("length");
    expect(normalizeAnthropicStopReason("tool_use")).toBe("tool_use");
    expect(normalizeAnthropicStopReason("stop_sequence")).toBe("stop_sequence");
    expect(normalizeAnthropicStopReason("refusal")).toBe("content_filter");
    expect(normalizeAnthropicStopReason("pause_turn")).toBe("pause");
  });

  it("maps model_context_window_exceeded to length", () => {
    expect(normalizeAnthropicStopReason("model_context_window_exceeded")).toBe("length");
  });

  it("falls back to other for unknown/missing", () => {
    expect(normalizeAnthropicStopReason("something_new")).toBe("other");
    expect(normalizeAnthropicStopReason(null)).toBe("other");
  });
});

describe("normalizeGoogleStopReason", () => {
  it("maps the Google finishReason vocabulary", () => {
    expect(normalizeGoogleStopReason("STOP", false)).toBe("stop");
    expect(normalizeGoogleStopReason("MAX_TOKENS", false)).toBe("length");
    expect(normalizeGoogleStopReason("SAFETY", false)).toBe("content_filter");
    expect(normalizeGoogleStopReason("PROHIBITED_CONTENT", false)).toBe("content_filter");
    expect(normalizeGoogleStopReason("RECITATION", false)).toBe("content_filter");
    expect(normalizeGoogleStopReason("IMAGE_SAFETY", false)).toBe("content_filter");
    expect(normalizeGoogleStopReason("LANGUAGE", false)).toBe("content_filter");
  });

  it("infers tool_use when finishReason is STOP but tool calls are present", () => {
    expect(normalizeGoogleStopReason("STOP", true)).toBe("tool_use");
  });

  it("does not override a non-STOP reason even with tool calls present", () => {
    expect(normalizeGoogleStopReason("MAX_TOKENS", true)).toBe("length");
  });

  it("falls back to other for unknown/missing", () => {
    expect(normalizeGoogleStopReason("MALFORMED_FUNCTION_CALL", false)).toBe("other");
    expect(normalizeGoogleStopReason(null, false)).toBe("other");
  });
});

describe("normalizeOllamaStopReason", () => {
  it("maps the Ollama done_reason vocabulary", () => {
    expect(normalizeOllamaStopReason("stop")).toBe("stop");
    expect(normalizeOllamaStopReason("length")).toBe("length");
  });

  it("falls back to other for unknown/missing", () => {
    expect(normalizeOllamaStopReason("load")).toBe("other");
    expect(normalizeOllamaStopReason(undefined)).toBe("other");
  });
});

describe("normalizeOpenAIResponsesStopReason", () => {
  it("maps incomplete reasons", () => {
    expect(
      normalizeOpenAIResponsesStopReason("incomplete", "max_output_tokens", false),
    ).toBe("length");
    expect(
      normalizeOpenAIResponsesStopReason("incomplete", "content_filter", false),
    ).toBe("content_filter");
  });

  it("infers tool_use when the completed response carries tool calls", () => {
    expect(normalizeOpenAIResponsesStopReason("completed", undefined, true)).toBe("tool_use");
  });

  it("maps a plain completed response to stop", () => {
    expect(normalizeOpenAIResponsesStopReason("completed", undefined, false)).toBe("stop");
  });

  it("infers tool_use when status is unknown but tool calls are present", () => {
    // e.g. a stream that ended without a completed/incomplete event.
    expect(normalizeOpenAIResponsesStopReason(undefined, undefined, true)).toBe("tool_use");
  });

  it("does not infer tool_use for an explicit failure status", () => {
    expect(normalizeOpenAIResponsesStopReason("failed", undefined, true)).toBe("other");
  });

  it("falls back to other for unknown/missing", () => {
    expect(normalizeOpenAIResponsesStopReason("failed", undefined, false)).toBe("other");
    expect(normalizeOpenAIResponsesStopReason(null, null, false)).toBe("other");
  });
});
