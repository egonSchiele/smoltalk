import { describe, it, expect } from "vitest";
import { AssistantMessage } from "./AssistantMessage.js";
import { UserMessage } from "./UserMessage.js";
import { SystemMessage } from "./SystemMessage.js";
import { DeveloperMessage } from "./DeveloperMessage.js";
import { ToolMessage } from "./ToolMessage.js";
import { ToolCall } from "../ToolCall.js";

// metadata is the caller's data about a message, such as a debug label or
// when the caller means to remove it. smoltalk keeps it through a JSON round
// trip and never sends it to a provider.
const metadata = { label: "verifier", expires: { at: "llmCall", key: "k1" } };

const roundTrip = (m: { toJSON(): unknown }) => JSON.parse(JSON.stringify(m));

describe("metadata survives toJSON and fromJSON", () => {
  it("on a user message", () => {
    const m = new UserMessage("hi", { metadata });
    expect(UserMessage.fromJSON(roundTrip(m)).metadata).toEqual(metadata);
  });

  it("on a system message", () => {
    const m = new SystemMessage("be brief", { metadata });
    expect(SystemMessage.fromJSON(roundTrip(m)).metadata).toEqual(metadata);
  });

  it("on an assistant message", () => {
    const m = new AssistantMessage("yes", { metadata });
    expect(AssistantMessage.fromJSON(roundTrip(m)).metadata).toEqual(metadata);
  });

  it("on a developer message", () => {
    const m = new DeveloperMessage("be brief", { metadata });
    expect(DeveloperMessage.fromJSON(roundTrip(m)).metadata).toEqual(metadata);
  });

  it("on a tool message", () => {
    const m = new ToolMessage("ok", { tool_call_id: "c1", name: "t", metadata });
    expect(ToolMessage.fromJSON(roundTrip(m)).metadata).toEqual(metadata);
  });

  it("is left out of the JSON when unset", () => {
    expect(JSON.stringify(new UserMessage("hi"))).not.toContain("metadata");
    expect(JSON.stringify(new SystemMessage("be brief"))).not.toContain("metadata");
    expect(JSON.stringify(new AssistantMessage("yes"))).not.toContain("metadata");
    expect(JSON.stringify(new ToolMessage("ok", { tool_call_id: "c1", name: "t" }))).not.toContain(
      "metadata",
    );
  });
});

describe("metadata never reaches a provider", () => {
  it("in any rendering of a user message", () => {
    const m = new UserMessage("hi", { metadata });
    expect(JSON.stringify(m.toOpenAIMessage())).not.toContain("verifier");
    expect(JSON.stringify(m.toOpenAIResponseInputItem())).not.toContain("verifier");
    expect(JSON.stringify(m.toGoogleMessage())).not.toContain("verifier");
    expect(JSON.stringify(m.toOllamaMessage())).not.toContain("verifier");
    expect(JSON.stringify(m.toAnthropicMessage())).not.toContain("verifier");
  });

  it("in any rendering of a system message", () => {
    const m = new SystemMessage("be brief", { metadata });
    expect(JSON.stringify(m.toOpenAIMessage())).not.toContain("verifier");
    expect(JSON.stringify(m.toOpenAIResponseInputItem())).not.toContain("verifier");
    expect(JSON.stringify(m.toGoogleMessage())).not.toContain("verifier");
    expect(JSON.stringify(m.toOllamaMessage())).not.toContain("verifier");
  });

  it("in any rendering of an assistant message with a tool call", () => {
    const m = new AssistantMessage("calling", {
      toolCalls: [new ToolCall("c1", "lookup", { q: "x" })],
      metadata,
    });
    expect(JSON.stringify(m.toOpenAIMessage())).not.toContain("verifier");
    expect(JSON.stringify(m.toOpenAIResponseInputItem())).not.toContain("verifier");
    expect(JSON.stringify(m.toGoogleMessage())).not.toContain("verifier");
    expect(JSON.stringify(m.toOllamaMessage())).not.toContain("verifier");
    expect(JSON.stringify(m.toAnthropicMessage())).not.toContain("verifier");
  });

  it("in any rendering of a tool message", () => {
    const m = new ToolMessage("ok", { tool_call_id: "c1", name: "t", metadata });
    expect(JSON.stringify(m.toOpenAIMessage())).not.toContain("verifier");
    expect(JSON.stringify(m.toOpenAIResponseInputItem())).not.toContain("verifier");
    expect(JSON.stringify(m.toGoogleMessage())).not.toContain("verifier");
    expect(JSON.stringify(m.toOllamaMessage())).not.toContain("verifier");
    expect(JSON.stringify(m.toAnthropicMessage())).not.toContain("verifier");
  });
});
