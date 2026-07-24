import { describe, it, expect } from "vitest";
import { SmolGoogle, reorderToolResultsForGemini } from "./google.js";
import {
  AssistantMessage,
  ToolMessage,
  userMessage,
} from "../classes/message/index.js";
import { ToolCall } from "../classes/ToolCall.js";

function assistantWithCalls(calls: Array<{ id?: string; name: string }>) {
  return new AssistantMessage(null, {
    toolCalls: calls.map((c) => new ToolCall(c.id ?? "", c.name, {})),
  });
}

function toolResult(name: string, content: string, tool_call_id = "") {
  return new ToolMessage(content, { name, tool_call_id });
}

// Read the run of tool results (name + content) out of a reordered list.
function resultNames(msgs: any[]) {
  return msgs.filter((m) => m.role === "tool").map((m) => m.content);
}

function makeClient() {
  return new SmolGoogle({
    model: "gemini-3-pro-preview",
    apiKey: { google: "test-key" },
    messages: [],
  } as any);
}

// Change 1: the non-streaming parser must keep the functionCall id so that
// Gemini 3.5+ id-based pairing can round-trip. It must NOT fall back to the
// function name (two parallel calls to the same tool would collide on a fake
// shared id, recreating the pairing bug at the id layer).
describe("Google non-streaming parse: functionCall id", () => {
  it("keeps functionCall.id on the ToolCall", async () => {
    const client = makeClient();
    (client as any).client = {
      models: {
        generateContent: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  { functionCall: { id: "abc", name: "readFile", args: { p: "x" } } },
                ],
              },
            },
          ],
          usageMetadata: {},
        }),
      },
    };
    const res = await (client as any).__textSync({
      model: "gemini-3-pro-preview",
      contents: [],
      config: {},
    });
    expect(res.success).toBe(true);
    expect(res.value.toolCalls[0].id).toBe("abc");
  });

  it("leaves id empty (not the name) when the model sends no id", async () => {
    const client = makeClient();
    (client as any).client = {
      models: {
        generateContent: async () => ({
          candidates: [
            {
              content: {
                parts: [{ functionCall: { name: "readFile", args: { p: "x" } } }],
              },
            },
          ],
          usageMetadata: {},
        }),
      },
    };
    const res = await (client as any).__textSync({
      model: "gemini-3-pro-preview",
      contents: [],
      config: {},
    });
    expect(res.success).toBe(true);
    expect(res.value.toolCalls[0].id).toBe("");
  });
});

// Change 3: the defensive reorder. Gemini 3 pairs functionResponse to
// functionCall by POSITION (no ids), so the run of tool results following an
// assistant's tool calls must be reordered to match call order. Never drop.
describe("reorderToolResultsForGemini", () => {
  it("reorders reversed results back into call order (by name)", () => {
    const thread = [
      userMessage("go"),
      assistantWithCalls([{ name: "readFile" }, { name: "writeFile" }]),
      toolResult("writeFile", "wrote"),
      toolResult("readFile", "contents"),
    ];
    const out = reorderToolResultsForGemini(thread);
    expect(resultNames(out)).toEqual(["contents", "wrote"]);
  });

  it("pairs by id when both sides have non-empty ids (even with duplicate names)", () => {
    const thread = [
      assistantWithCalls([
        { id: "1", name: "run" },
        { id: "2", name: "run" },
      ]),
      toolResult("run", "answer-2", "2"),
      toolResult("run", "answer-1", "1"),
    ];
    const out = reorderToolResultsForGemini(thread);
    expect(resultNames(out)).toEqual(["answer-1", "answer-2"]);
  });

  it("prefers id pairing over name occurrence when they disagree", () => {
    // call A: no id, name foo. call B: id 9, name foo.
    // responses: r1 has id 9 (belongs to B), r2 has no id (belongs to A).
    const thread = [
      assistantWithCalls([
        { id: "", name: "foo" },
        { id: "9", name: "foo" },
      ]),
      toolResult("foo", "for-B", "9"),
      toolResult("foo", "for-A", ""),
    ];
    const out = reorderToolResultsForGemini(thread);
    // A (call order first) → for-A, B → for-B
    expect(resultNames(out)).toEqual(["for-A", "for-B"]);
  });

  it("pairs duplicate names by occurrence, preserving same-name order", () => {
    const thread = [
      assistantWithCalls([
        { name: "foo" },
        { name: "bar" },
        { name: "foo" },
      ]),
      toolResult("bar", "bar-resp"),
      toolResult("foo", "foo-first"),
      toolResult("foo", "foo-second"),
    ];
    const out = reorderToolResultsForGemini(thread);
    // call order [foo, bar, foo] → first foo, bar, second foo
    expect(resultNames(out)).toEqual(["foo-first", "bar-resp", "foo-second"]);
  });

  it("keeps an unmatched extra result at the end of the run (never drops)", () => {
    const thread = [
      assistantWithCalls([{ name: "foo" }]),
      toolResult("foo", "foo-resp"),
      toolResult("baz", "orphan"),
    ];
    const out = reorderToolResultsForGemini(thread);
    expect(resultNames(out)).toEqual(["foo-resp", "orphan"]);
  });

  it("keeps a surplus same-name result at the end (never drops)", () => {
    const thread = [
      assistantWithCalls([{ name: "foo" }]),
      toolResult("foo", "matched"),
      toolResult("foo", "surplus"),
    ];
    const out = reorderToolResultsForGemini(thread);
    expect(resultNames(out)).toEqual(["matched", "surplus"]);
  });

  it("passes a thread with no tool messages through untouched", () => {
    const thread = [
      userMessage("hi"),
      new AssistantMessage("hello", {}),
      userMessage("bye"),
    ];
    const out = reorderToolResultsForGemini(thread);
    expect(out).toEqual(thread);
  });

  it("reorders each round independently", () => {
    const thread = [
      assistantWithCalls([{ name: "a" }, { name: "b" }]),
      toolResult("b", "b1"),
      toolResult("a", "a1"),
      new AssistantMessage("mid", {}),
      assistantWithCalls([{ name: "c" }, { name: "d" }]),
      toolResult("d", "d1"),
      toolResult("c", "c1"),
    ];
    const out = reorderToolResultsForGemini(thread);
    expect(resultNames(out)).toEqual(["a1", "b1", "c1", "d1"]);
  });

  it("does not lose any message (count is preserved)", () => {
    const thread = [
      userMessage("go"),
      assistantWithCalls([{ name: "readFile" }, { name: "writeFile" }]),
      toolResult("writeFile", "wrote"),
      toolResult("readFile", "contents"),
    ];
    const out = reorderToolResultsForGemini(thread);
    expect(out).toHaveLength(thread.length);
  });
});

describe("SmolGoogle.buildRequest — tool result reorder integration", () => {
  it("emits functionResponse parts in call order", () => {
    const client = makeClient();
    const req = (client as any).buildRequest({
      model: "gemini-3-pro-preview",
      messages: [
        assistantWithCalls([{ name: "readFile" }, { name: "writeFile" }]),
        toolResult("writeFile", "wrote"),
        toolResult("readFile", "contents"),
      ],
    });
    const responseNames = (req.contents as any[])
      .flatMap((c) => c.parts ?? [])
      .filter((p) => p.functionResponse)
      .map((p) => p.functionResponse.name);
    expect(responseNames).toEqual(["readFile", "writeFile"]);
  });
});
