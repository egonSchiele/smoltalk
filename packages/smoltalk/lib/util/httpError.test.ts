import { describe, it, expect } from "vitest";
import { extractHttpErrorFields } from "./httpError.js";

describe("extractHttpErrorFields", () => {
  it("returns empty fields for non-objects", () => {
    expect(extractHttpErrorFields(undefined)).toEqual({});
    expect(extractHttpErrorFields("oops")).toEqual({});
    expect(extractHttpErrorFields(null)).toEqual({});
  });

  it("reads a numeric `status` (OpenAI/Anthropic/Google shape)", () => {
    expect(extractHttpErrorFields({ status: 429 })).toEqual({ status: 429 });
  });

  it("reads `statusCode` and `status_code` (Ollama shape)", () => {
    expect(extractHttpErrorFields({ statusCode: 503 })).toEqual({ status: 503 });
    expect(extractHttpErrorFields({ status_code: 404 })).toEqual({ status: 404 });
  });

  it("ignores a non-numeric status", () => {
    expect(extractHttpErrorFields({ status: "nope" })).toEqual({});
  });

  it("normalizes a web `Headers` instance", () => {
    const headers = new Headers({ "content-type": "application/json" });
    expect(extractHttpErrorFields({ status: 429, headers })).toEqual({
      status: 429,
      headers: { "content-type": "application/json" },
    });
  });

  it("omits headers when empty", () => {
    expect(extractHttpErrorFields({ status: 500, headers: {} })).toEqual({
      status: 500,
    });
  });

  describe("header allowlist", () => {
    it("keeps only allowlisted headers and the ratelimit/request-id families", () => {
      const headers = new Headers({
        "retry-after": "5",
        "x-ratelimit-remaining-requests": "10",
        "anthropic-ratelimit-tokens-remaining": "1000",
        "x-request-id": "req_123",
        "content-type": "application/json",
        // Everything below must be dropped:
        authorization: "Bearer sk-secret",
        "x-api-key": "secret-key",
        "set-cookie": "__cf_bm=token",
        "llm_provider-x-upstream-secret": "leaked",
        "openai-organization": "org-abc",
      });
      expect(extractHttpErrorFields({ status: 429, headers }).headers).toEqual({
        "retry-after": "5",
        "x-ratelimit-remaining-requests": "10",
        "anthropic-ratelimit-tokens-remaining": "1000",
        "x-request-id": "req_123",
        "content-type": "application/json",
      });
    });

    it("drops credential/session headers from a plain-object map (case-insensitively)", () => {
      const { headers } = extractHttpErrorFields({
        headers: {
          Authorization: "Bearer sk-secret",
          "Set-Cookie": "session=abc",
          "Content-Type": "application/json",
        },
      });
      expect(headers).toEqual({ "Content-Type": "application/json" });
    });

    it("returns no headers when nothing is allowlisted", () => {
      const headers = new Headers({ "set-cookie": "__cf_bm=token" });
      expect(extractHttpErrorFields({ status: 503, headers }).headers).toBeUndefined();
    });
  });

  describe("requestId", () => {
    it("reads the SDK's parsed `requestID` property first", () => {
      const headers = new Headers({ "x-request-id": "from-header" });
      expect(
        extractHttpErrorFields({ requestID: "from-sdk", headers }).requestId,
      ).toBe("from-sdk");
    });

    it("reads a snake_case `request_id` property", () => {
      expect(extractHttpErrorFields({ request_id: "req_snake" }).requestId).toBe(
        "req_snake",
      );
    });

    it("falls back to the `x-request-id` header (OpenAI)", () => {
      const headers = new Headers({ "x-request-id": "req_openai" });
      expect(extractHttpErrorFields({ headers }).requestId).toBe("req_openai");
    });

    it("falls back to the `request-id` header (Anthropic)", () => {
      const headers = new Headers({ "request-id": "req_anthropic" });
      expect(extractHttpErrorFields({ headers }).requestId).toBe("req_anthropic");
    });

    it("is absent when no request id is available", () => {
      const headers = new Headers({ "content-type": "application/json" });
      expect(extractHttpErrorFields({ status: 500, headers }).requestId).toBeUndefined();
    });
  });

  describe("retryAfterMs", () => {
    it("prefers `retry-after-ms` (millisecond precision)", () => {
      const headers = new Headers({ "retry-after-ms": "1500", "retry-after": "2" });
      expect(extractHttpErrorFields({ status: 429, headers }).retryAfterMs).toBe(
        1500,
      );
    });

    it("falls back to `retry-after` delta-seconds", () => {
      const headers = new Headers({ "retry-after": "30" });
      expect(extractHttpErrorFields({ status: 429, headers }).retryAfterMs).toBe(
        30000,
      );
    });

    it("parses a `retry-after` HTTP-date into a forward-looking delay", () => {
      const future = new Date(Date.now() + 10_000).toUTCString();
      const headers = new Headers({ "retry-after": future });
      const { retryAfterMs } = extractHttpErrorFields({ status: 503, headers });
      expect(retryAfterMs).toBeGreaterThan(8_000);
      expect(retryAfterMs).toBeLessThanOrEqual(10_000);
    });

    it("clamps a past HTTP-date to 0", () => {
      const past = new Date(Date.now() - 10_000).toUTCString();
      const headers = new Headers({ "retry-after": past });
      expect(extractHttpErrorFields({ headers }).retryAfterMs).toBe(0);
    });

    it("falls through to `retry-after` when `retry-after-ms` is unparseable", () => {
      const headers = new Headers({ "retry-after-ms": "soon", "retry-after": "5" });
      expect(extractHttpErrorFields({ headers }).retryAfterMs).toBe(5000);
    });

    it("rejects values with trailing junk instead of parsing a prefix", () => {
      const headers = new Headers({ "retry-after": "5xyz" });
      expect(extractHttpErrorFields({ headers }).retryAfterMs).toBeUndefined();
    });

    it("is absent when no retry headers are present", () => {
      const headers = new Headers({ "x-request-id": "abc" });
      expect(
        extractHttpErrorFields({ status: 500, headers }).retryAfterMs,
      ).toBeUndefined();
    });

    it("reads retry headers from a case-varied plain object", () => {
      expect(
        extractHttpErrorFields({ headers: { "Retry-After-Ms": "750" } })
          .retryAfterMs,
      ).toBe(750);
    });
  });
});
