import { describe, it, expect } from "vitest";
import { SmolOpenAiResponses } from "./openaiResponses.js";
import { userMessage } from "../classes/message/index.js";

function build(model: string, temperature: number) {
  const client = new SmolOpenAiResponses({
    model: model as any,
    provider: "openai-responses",
    messages: [],
    apiKey: { openAi: "k" },
  });
  return (client as any).buildRequest({
    model,
    provider: "openai-responses",
    messages: [userMessage("hi")],
    temperature,
  });
}

describe("SmolOpenAiResponses temperature", () => {
  it("drops temperature for a model that rejects it", () => {
    expect(build("gpt-6.1-terra", 0.2)).not.toHaveProperty("temperature");
  });

  it("keeps temperature for a model that accepts it", () => {
    expect(build("gpt-4o", 0.2).temperature).toBe(0.2);
  });

  it("keeps temperature for a model the registry doesn't know", () => {
    expect(build("gpt-future-model", 0.2).temperature).toBe(0.2);
  });
});
