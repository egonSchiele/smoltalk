import { describe, it, expect } from "vitest";
import {
  canReplay,
  chatReasoningFields,
  mergeReasoningDetails,
  replayableThinkingBlocks,
  responsesReasoningEntries,
} from "./reasoning.js";
import { ReasoningRecordSchema, type ReasoningRecord } from "../types.js";

const rec: ReasoningRecord = {
  provider: "openrouter",
  model: "z-ai/glm-5.3-flash",
  text: "think",
  format: "reasoning",
};

const target = { provider: "openrouter", model: "z-ai/glm-5.3-flash", replayRecords: true };

describe("canReplay", () => {
  it("replays to the same provider and model", () => {
    expect(canReplay(rec, target)).toBe(true);
  });
  it("does not replay to another model or provider, or when records are off", () => {
    expect(canReplay(rec, { ...target, model: "moonshotai/kimi-k3" })).toBe(false);
    expect(canReplay(rec, { ...target, provider: "deepinfra" })).toBe(false);
    expect(canReplay(rec, { ...target, replayRecords: false })).toBe(false);
  });
});

describe("replayableThinkingBlocks", () => {
  it("keeps thinking blocks from the target's provider and untagged ones, whatever replayRecords says", () => {
    const blocks = [
      { text: "a", signature: "s1", provider: "anthropic" },
      { text: "g", signature: "s2", provider: "google" },
      { text: "old", signature: "s3" },
    ];
    const anthropic = { provider: "anthropic", model: "claude-opus-5-5", replayRecords: false };
    expect(replayableThinkingBlocks(blocks, anthropic).map((block) => block.text)).toEqual(["a", "old"]);
  });
});

describe("chatReasoningFields", () => {
  it("sends reasoning_details when OpenRouter gave them, else the text", () => {
    expect(
      chatReasoningFields({ ...rec, text: "", details: [{ type: "reasoning.text", text: "think" }] }),
    ).toEqual({ reasoning_details: [{ type: "reasoning.text", text: "think" }] });
    expect(chatReasoningFields(rec)).toEqual({ reasoning: "think" });
  });
  it("sends reasoning_content back in reasoning_content", () => {
    expect(chatReasoningFields({ ...rec, format: "reasoning_content" })).toEqual({
      reasoning_content: "think",
    });
  });
  it("sends nothing in a chat message for Responses items", () => {
    expect(chatReasoningFields({ ...rec, format: "responsesItems", responsesItems: [] })).toEqual({});
  });
});

describe("ReasoningRecordSchema", () => {
  it("accepts a record and refuses a bad format", () => {
    expect(ReasoningRecordSchema.safeParse(rec).success).toBe(true);
    expect(ReasoningRecordSchema.safeParse({ ...rec, format: "other" }).success).toBe(false);
  });
});

describe("mergeReasoningDetails", () => {
  it("merges pieces that share an index into one entry, keeping the signature", () => {
    const pieces = [
      { type: "reasoning.text", text: "th", index: 0 },
      { type: "reasoning.text", text: "ink", index: 0 },
      { type: "reasoning.text", signature: "sig", index: 0 },
    ];
    expect(mergeReasoningDetails(pieces)).toEqual([
      { type: "reasoning.text", text: "think", signature: "sig", index: 0 },
    ]);
  });
  it("keeps separate indexes apart, in index order, and joins summary and data", () => {
    const pieces = [
      { type: "reasoning.summary", summary: "a", index: 1 },
      { type: "reasoning.encrypted", data: "x", index: 0 },
      { type: "reasoning.summary", summary: "b", index: 1 },
      { type: "reasoning.encrypted", data: "y", index: 0, id: "r1" },
    ];
    expect(mergeReasoningDetails(pieces)).toEqual([
      { type: "reasoning.encrypted", data: "xy", index: 0, id: "r1" },
      { type: "reasoning.summary", summary: "ab", index: 1 },
    ]);
  });
  it("keeps a piece with no index as its own entry", () => {
    const pieces = [{ type: "reasoning.text", text: "solo" }];
    expect(mergeReasoningDetails(pieces)).toEqual([{ type: "reasoning.text", text: "solo" }]);
  });
});

describe("responsesReasoningEntries", () => {
  const encrypted = (id: string) => ({ type: "reasoning", id, encrypted_content: "e", summary: [] });
  const call = (callId: string) => ({ type: "function_call", call_id: callId });

  it("keeps only items that carry encrypted content", () => {
    const bare = { type: "reasoning", id: "rs_bare", summary: [] };
    expect(responsesReasoningEntries([bare, call("c1")])).toEqual([]);
  });

  it("pairs a reasoning item only with the item directly after it", () => {
    const output = [encrypted("rs_1"), { type: "web_search_call", id: "ws_1" }, encrypted("rs_2"), { type: "message" }];
    expect(responsesReasoningEntries(output)).toEqual([{ item: encrypted("rs_2"), followedBy: "message" }]);
  });
});
