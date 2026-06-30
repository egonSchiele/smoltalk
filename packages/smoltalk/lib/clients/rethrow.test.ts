import { describe, it, expect } from "vitest";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { SmolOpenAi } from "./openai.js";
import { SmolAnthropic } from "./anthropic.js";
import {
  SmolError,
  SmolRateLimitError,
  SmolAuthError,
  SmolContextWindowExceededError,
} from "../smolError.js";

// Exercise the private rethrowAsSmolError wiring directly with hand-rolled,
// SDK-shaped errors — no live API calls — to lock down that status/headers/
// requestId/retryAfterMs actually flow through to the thrown SmolError.
function rethrow(client: unknown, error: unknown): SmolError {
  try {
    (client as any).rethrowAsSmolError(error);
  } catch (thrown) {
    return thrown as SmolError;
  }
  throw new Error("rethrowAsSmolError did not throw");
}

describe("SmolOpenAi.rethrowAsSmolError", () => {
  const client = new SmolOpenAi({
    model: "gpt-4o-mini",
    apiKey: { openAi: "test-key" },
    messages: [],
  });

  it("maps a 429 APIError to SmolRateLimitError with status/headers/retryAfterMs", () => {
    const headers = new Headers({
      "retry-after-ms": "2000",
      "x-request-id": "req_openai",
      "set-cookie": "__cf_bm=secret",
    });
    const apiError = new OpenAI.APIError(429, { message: "slow down" }, "slow down", headers);

    const err = rethrow(client, apiError);

    expect(err).toBeInstanceOf(SmolRateLimitError);
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(2000);
    expect(err.requestId).toBe("req_openai");
    expect(err.headers).not.toHaveProperty("set-cookie");
    expect(err.cause).toBe(apiError);
  });

  it("maps a 401 APIError to SmolAuthError", () => {
    const apiError = new OpenAI.APIError(401, { message: "bad key" }, "bad key", new Headers());
    expect(rethrow(client, apiError)).toBeInstanceOf(SmolAuthError);
  });

  it("classifies context_length_exceeded regardless of status", () => {
    const apiError = new OpenAI.APIError(
      400,
      { code: "context_length_exceeded", message: "too long" },
      "too long",
      new Headers(),
    );
    expect(rethrow(client, apiError)).toBeInstanceOf(
      SmolContextWindowExceededError,
    );
  });

  it("rethrows non-APIError values untouched", () => {
    const plain = new Error("network down");
    let thrown: unknown;
    try {
      (client as any).rethrowAsSmolError(plain);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(plain);
    expect(thrown).not.toBeInstanceOf(SmolError);
  });
});

describe("SmolAnthropic.rethrowAsSmolError", () => {
  const client = new SmolAnthropic({
    model: "claude-sonnet-4-6",
    apiKey: { anthropic: "test-key" },
    messages: [],
  });

  it("maps a 429 APIError to SmolRateLimitError with request id from header", () => {
    const headers = new Headers({
      "retry-after": "30",
      "request-id": "req_anthropic",
    });
    const apiError = new Anthropic.APIError(429, { message: "rate limited" }, "rate limited", headers);

    const err = rethrow(client, apiError);

    expect(err).toBeInstanceOf(SmolRateLimitError);
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(30000);
    expect(err.requestId).toBe("req_anthropic");
  });

  it("classifies a context-window message to SmolContextWindowExceededError", () => {
    const apiError = new Anthropic.APIError(
      400,
      { message: "prompt is too long: 250000 tokens > 200000 maximum" },
      "prompt is too long: 250000 tokens > 200000 maximum",
      new Headers(),
    );
    expect(rethrow(client, apiError)).toBeInstanceOf(
      SmolContextWindowExceededError,
    );
  });
});
