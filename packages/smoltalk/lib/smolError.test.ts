import { describe, it, expect } from "vitest";
import {
  SmolError,
  SmolContentPolicyError,
  SmolContextWindowExceededError,
  SmolStructuredOutputError,
  SmolTimeoutError,
} from "./smolError.js";

describe("SmolError", () => {
  it("defaults status/headers to undefined when no options given", () => {
    const err = new SmolError("boom");
    expect(err.message).toBe("boom");
    expect(err.status).toBeUndefined();
    expect(err.headers).toBeUndefined();
    expect(err).toBeInstanceOf(Error);
  });

  it("exposes status, headers, retryAfterMs, and cause", () => {
    const cause = new Error("underlying");
    const err = new SmolError("rate limited", {
      status: 429,
      headers: { "retry-after": "30" },
      retryAfterMs: 30000,
      cause,
    });
    expect(err.status).toBe(429);
    expect(err.headers).toEqual({ "retry-after": "30" });
    expect(err.retryAfterMs).toBe(30000);
    expect(err.cause).toBe(cause);
  });

  it("defaults retryAfterMs to undefined", () => {
    expect(new SmolError("boom").retryAfterMs).toBeUndefined();
  });

  const subclasses = [
    SmolContentPolicyError,
    SmolContextWindowExceededError,
    SmolStructuredOutputError,
    SmolTimeoutError,
  ];

  it.each(subclasses)("subclass %p carries http fields", (Subclass) => {
    const err = new Subclass("oops", {
      status: 400,
      headers: { "x-request-id": "abc" },
    });
    expect(err).toBeInstanceOf(SmolError);
    expect(err.status).toBe(400);
    expect(err.headers).toEqual({ "x-request-id": "abc" });
  });
});
