// The openai and @anthropic-ai/sdk constructors refuse to run in a browser
// unless told `dangerouslyAllowBrowser: true`. smoltalk passes it always: it
// does nothing in Node, and a browser caller has already chosen to put a key
// in the page. This pins the option on each client's constructor call.
import { beforeEach, describe, expect, it, vi } from "vitest";

const openAiOptions: unknown[] = [];
const anthropicOptions: unknown[] = [];

vi.mock("openai", () => {
  function MockOpenAI(this: Record<string, unknown>, options: unknown) {
    openAiOptions.push(options);
  }
  return { __esModule: true, default: MockOpenAI };
});

vi.mock("@anthropic-ai/sdk", () => {
  function MockAnthropic(this: Record<string, unknown>, options: unknown) {
    anthropicOptions.push(options);
  }
  return { __esModule: true, default: MockAnthropic };
});

import { SmolOpenAi } from "./openai.js";
import { SmolOpenAiResponses } from "./openaiResponses.js";
import { SmolAnthropic } from "./anthropic.js";

describe("dangerouslyAllowBrowser", () => {
  beforeEach(() => {
    openAiOptions.length = 0;
    anthropicOptions.length = 0;
  });

  it("is passed by the OpenAI chat client", () => {
    new SmolOpenAi({ model: "gpt-4o-mini", apiKey: { openAi: "k" } });
    expect(openAiOptions).toEqual([{ apiKey: "k", dangerouslyAllowBrowser: true }]);
  });

  it("is passed by the OpenAI responses client", () => {
    new SmolOpenAiResponses({ model: "gpt-4o-mini", apiKey: { openAi: "k" } });
    expect(openAiOptions).toEqual([{ apiKey: "k", dangerouslyAllowBrowser: true }]);
  });

  it("is passed by the Anthropic client", () => {
    new SmolAnthropic({ model: "claude-sonnet-4-5", apiKey: { anthropic: "k" } });
    expect(anthropicOptions).toEqual([{ apiKey: "k", dangerouslyAllowBrowser: true }]);
  });
});
