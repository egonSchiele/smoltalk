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
    const headers = new Headers({ "content-type": "application/json", "x-request-id": "abc" });
    expect(extractHttpErrorFields({ status: 429, headers })).toEqual({
      status: 429,
      headers: { "content-type": "application/json", "x-request-id": "abc" },
    });
  });

  it("normalizes a plain-object headers map", () => {
    expect(
      extractHttpErrorFields({ headers: { "X-Foo": "bar", skip: 5 } }),
    ).toEqual({ headers: { "X-Foo": "bar" } });
  });

  it("strips session/cookie headers (case-insensitively)", () => {
    const headers = new Headers({
      "set-cookie": "__cf_bm=secret; Path=/",
      "x-request-id": "abc",
    });
    headers.append("Set-Cookie", "_cfuvid=token");
    expect(extractHttpErrorFields({ status: 429, headers })).toEqual({
      status: 429,
      headers: { "x-request-id": "abc" },
    });
  });

  it("strips cookie headers from a plain-object map", () => {
    expect(
      extractHttpErrorFields({
        headers: { Cookie: "session=abc", "x-foo": "bar" },
      }),
    ).toEqual({ headers: { "x-foo": "bar" } });
  });

  it("omits headers when empty", () => {
    expect(extractHttpErrorFields({ status: 500, headers: {} })).toEqual({
      status: 500,
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
