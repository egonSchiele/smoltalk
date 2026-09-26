import { describe, it, expect } from "vitest";
import { AssistantMessage } from "./AssistantMessage.js";
import { UserMessage } from "./UserMessage.js";
import { SystemMessage } from "./SystemMessage.js";
import { DeveloperMessage } from "./DeveloperMessage.js";
import { ToolMessage } from "./ToolMessage.js";

// rawData is a slot for whatever a caller wants to keep on a message, such
// as a decision model's full answers. It has to survive a JSON round trip,
// or a caller that checkpoints its thread loses it.
describe("rawData survives toJSON and fromJSON", () => {
  const rawData = { answers: { churn: { type: "noul", noul: 0.91 } } };

  it("on an assistant message", () => {
    const m = new AssistantMessage("yes", { rawData });
    expect(
      AssistantMessage.fromJSON(JSON.parse(JSON.stringify(m))).rawData,
    ).toEqual(rawData);
  });

  it("on a user message", () => {
    const m = new UserMessage("hi", { rawData });
    expect(UserMessage.fromJSON(JSON.parse(JSON.stringify(m))).rawData).toEqual(
      rawData,
    );
  });

  it("on a system message", () => {
    const m = new SystemMessage("be brief", { rawData });
    expect(
      SystemMessage.fromJSON(JSON.parse(JSON.stringify(m))).rawData,
    ).toEqual(rawData);
  });

  it("on a developer message", () => {
    const m = new DeveloperMessage("be brief", { rawData });
    expect(DeveloperMessage.fromJSON(JSON.parse(JSON.stringify(m))).rawData).toEqual(rawData);
  });

  it("on a tool message", () => {
    const m = new ToolMessage("ok", { tool_call_id: "c1", name: "t", rawData });
    expect(ToolMessage.fromJSON(JSON.parse(JSON.stringify(m))).rawData).toEqual(
      rawData,
    );
  });

  it("is left out of the JSON when unset", () => {
    expect(JSON.stringify(new AssistantMessage("yes"))).not.toContain(
      "rawData",
    );
    expect(JSON.stringify(new UserMessage("hi"))).not.toContain("rawData");
  });

  it("keeps logprobs through toJSON and fromJSON", () => {
    const logprobs = [
      {
        token: "Hi",
        logprob: -0.1,
        top: [
          { token: "Hi", logprob: -0.1 },
          { token: "Hello", logprob: -2.3 },
        ],
      },
      { token: "!", logprob: -0.5 },
    ];
    const message = new AssistantMessage("Hi!", { logprobs });
    expect(
      AssistantMessage.fromJSON(JSON.parse(JSON.stringify(message))).logprobs,
    ).toEqual(logprobs);
    expect(JSON.stringify(new AssistantMessage("x"))).not.toContain("logprobs");
  });
});
