import { describe, it, expect } from "vitest";
import { AssistantMessage } from "./AssistantMessage.js";
import { ToolCall } from "../ToolCall.js";
import type { ReasoningRecord } from "../../types.js";

// A reasoning record rides on the assistant message and goes back only to
// the model that produced it. See "Reasoning sent back to the model" in
// CLAUDE.md.
const rec: ReasoningRecord = { provider: "openrouter", model: "m1", text: "think", format: "reasoning" };

describe("AssistantMessage reasoning", () => {
  it("keeps the record through toJSON and fromJSON", () => {
    const message = new AssistantMessage("hi", { reasoning: rec });
    expect(AssistantMessage.fromJSON(message.toJSON()).reasoning).toEqual(rec);
  });

  it("parses JSON saved before the field existed", () => {
    expect(AssistantMessage.fromJSON({ role: "assistant", content: "hi" }).reasoning).toBeUndefined();
  });

  it("adds the reasoning field for a matching target only", () => {
    const message = new AssistantMessage(null, {
      reasoning: rec,
      toolCalls: [new ToolCall("c1", "ls", {})],
    });
    const target = { provider: "openrouter", model: "m1", replayRecords: true };
    expect((message.toOpenAIMessage(target) as any).reasoning).toBe("think");
    expect((message.toOpenAIMessage({ ...target, model: "m2" }) as any).reasoning).toBeUndefined();
    expect((message.toOpenAIMessage() as any).reasoning).toBeUndefined();
  });

  it("puts each Responses reasoning item before the item that followed it", () => {
    const item = { type: "reasoning", id: "rs_1", encrypted_content: "xyz", summary: [] };
    const message = new AssistantMessage(null, {
      reasoning: {
        provider: "openai-responses",
        model: "m1",
        text: "",
        format: "responsesItems",
        responsesItems: [{ item, followedBy: "c1" }],
      },
      toolCalls: [new ToolCall("c1", "ls", {})],
    });
    const target = { provider: "openai-responses", model: "m1", replayRecords: true };
    const items = message.toOpenAIResponseInputItem(target) as any[];
    expect(items[0]).toEqual(item);
    expect(items[1].type).toBe("function_call");
  });

  it("keeps interleaved reasoning items in place, and drops one whose call is gone", () => {
    const first = { type: "reasoning", id: "rs_1", encrypted_content: "a", summary: [] };
    const second = { type: "reasoning", id: "rs_2", encrypted_content: "b", summary: [] };
    const orphan = { type: "reasoning", id: "rs_3", encrypted_content: "c", summary: [] };
    const message = new AssistantMessage(null, {
      reasoning: {
        provider: "openai-responses",
        model: "m1",
        text: "",
        format: "responsesItems",
        responsesItems: [
          { item: first, followedBy: "c1" },
          { item: second, followedBy: "c2" },
          { item: orphan, followedBy: "c9" },
        ],
      },
      toolCalls: [new ToolCall("c1", "ls", {}), new ToolCall("c2", "ls", {})],
    });
    const target = { provider: "openai-responses", model: "m1", replayRecords: true };
    const items = message.toOpenAIResponseInputItem(target) as any[];
    expect(items.map((item) => item.id ?? item.call_id)).toEqual(["rs_1", "c1", "rs_2", "c2"]);
  });

  it("puts a reasoning item that led to the reply's text before the message item", () => {
    const item = { type: "reasoning", id: "rs_1", encrypted_content: "a", summary: [] };
    const message = new AssistantMessage("done", {
      reasoning: {
        provider: "openai-responses",
        model: "m1",
        text: "",
        format: "responsesItems",
        responsesItems: [{ item, followedBy: "message" }],
      },
    });
    const target = { provider: "openai-responses", model: "m1", replayRecords: true };
    const items = message.toOpenAIResponseInputItem(target) as any[];
    expect(items.map((entry) => entry.type)).toEqual(["reasoning", "message"]);
  });
});
