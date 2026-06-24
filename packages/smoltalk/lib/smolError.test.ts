import { describe, it, expect } from "vitest";
import {
  SmolError,
  SmolContentPolicyError,
  SmolContextWindowExceededError,
  SmolStructuredOutputError,
  SmolTimeoutError,
  SmolRateLimitError,
  SmolOverloadedError,
  SmolAuthError,
  smolErrorForStatus,
} from "./smolError.js";

describe("SmolError", () => {
  it("defaults status/headers to undefined when no options given", () => {
    const err = new SmolError("boom");
    expect(err.message).toBe("boom");
    expect(err.status).toBeUndefined();
    expect(err.headers).toBeUndefined();
    expect(err).toBeInstanceOf(Error);
  });

  it("exposes status, headers, retryAfterMs, requestId, and cause", () => {
    const cause = new Error("underlying");
    const err = new SmolError("rate limited", {
      status: 429,
      headers: { "retry-after": "30" },
      retryAfterMs: 30000,
      requestId: "req_123",
      cause,
    });
    expect(err.status).toBe(429);
    expect(err.headers).toEqual({ "retry-after": "30" });
    expect(err.retryAfterMs).toBe(30000);
    expect(err.requestId).toBe("req_123");
    expect(err.cause).toBe(cause);
  });

  it("defaults retryAfterMs/requestId to undefined", () => {
    const err = new SmolError("boom");
    expect(err.retryAfterMs).toBeUndefined();
    expect(err.requestId).toBeUndefined();
  });

  const subclasses = [
    SmolContentPolicyError,
    SmolContextWindowExceededError,
    SmolStructuredOutputError,
    SmolTimeoutError,
    SmolRateLimitError,
    SmolOverloadedError,
    SmolAuthError,
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

describe("smolErrorForStatus", () => {
  it("maps 429 to SmolRateLimitError", () => {
    const err = smolErrorForStatus("slow down", { status: 429 });
    expect(err).toBeInstanceOf(SmolRateLimitError);
    expect(err.status).toBe(429);
  });

  it("maps 503 and 529 to SmolOverloadedError", () => {
    expect(smolErrorForStatus("busy", { status: 503 })).toBeInstanceOf(
      SmolOverloadedError,
    );
    expect(smolErrorForStatus("overloaded", { status: 529 })).toBeInstanceOf(
      SmolOverloadedError,
    );
  });

  it("maps 401 and 403 to SmolAuthError", () => {
    expect(smolErrorForStatus("nope", { status: 401 })).toBeInstanceOf(
      SmolAuthError,
    );
    expect(smolErrorForStatus("forbidden", { status: 403 })).toBeInstanceOf(
      SmolAuthError,
    );
  });

  it("falls back to the base SmolError for unclassified statuses", () => {
    const err = smolErrorForStatus("teapot", { status: 418 });
    expect(err).toBeInstanceOf(SmolError);
    expect(err).not.toBeInstanceOf(SmolRateLimitError);
    expect(err).not.toBeInstanceOf(SmolAuthError);
    expect(err).not.toBeInstanceOf(SmolOverloadedError);
  });

  it("forwards options through to the chosen subclass", () => {
    const err = smolErrorForStatus("slow down", {
      status: 429,
      headers: { "retry-after-ms": "2000" },
      retryAfterMs: 2000,
      requestId: "req_xyz",
    });
    expect(err.retryAfterMs).toBe(2000);
    expect(err.requestId).toBe("req_xyz");
    expect(err.headers).toEqual({ "retry-after-ms": "2000" });
  });
});
